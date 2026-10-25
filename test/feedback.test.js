import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { generate, ollamaChat, ollamaStatus } from '../src/llm.js';
import { makeDemo, DEFAULT_REQUIREMENTS } from '../public/engine.js';
import { summarize } from '../src/metrics.js';

test('critic and generator receive the intended feedback with no validator leak', async () => {
  const raw = JSON.stringify(makeDemo(42, undefined, true));
  for (const mode of ['none', 'critic', 'validator', 'hybrid']) {
    const calls = [];
    const fake = async (messages, options) => { calls.push({ messages, options }); return { raw: options.schema ? JSON.stringify(makeDemo(42)) : 'Нужно уменьшить стену.', model: 'mock', elapsedMs: 0 }; };
    const result = await generate({ prompt: 'Test', requirements: DEFAULT_REQUIREMENTS, seed: 42, previous: raw, mode }, fake);
    assert.equal(result.report.passed, true);
    const withCritic = ['critic', 'hybrid'].includes(mode);
    assert.equal(calls.length, withCritic ? 2 : 1);
    if (withCritic) { const criticInput = JSON.stringify(calls[0].messages); assert.ok(!criticInput.includes('NO_PATH')); assert.ok(!criticInput.includes('Exact proxy validator output:')); }
    const last = JSON.stringify(calls.at(-1).messages);
    assert.equal(last.includes('Exact proxy validator output:'), ['validator', 'hybrid'].includes(mode));
    assert.equal(last.includes('Нужно уменьшить стену.'), withCritic);
    assert.equal(last.includes('NO_PATH'), ['validator', 'hybrid'].includes(mode));
  }
});
test('initial generation has no feedback in any arm; human game report stays separately labelled', async () => {
  const calls = [];
  const chat = async messages => { calls.push(messages); return { raw: JSON.stringify(makeDemo(42)) }; };
  await generate({ prompt: 'Test', requirements: DEFAULT_REQUIREMENTS, seed: 42 }, chat);
  assert.equal(calls[0].length, 2);
  const result = await generate({ prompt: 'Test', requirements: DEFAULT_REQUIREMENTS, seed: 42, previous: '{}', mode: 'none', playtest: { status: 'failed', notes: 'wall' } }, chat);
  assert.equal(result.hasHumanFeedback, true);
  assert.match(JSON.stringify(calls[1]), /Human-reported playtest/);
});
test('real HTTP adapter sends Ollama schema and seed, returns errors without fallback', async () => {
  let request;
  const mock = createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/tags') return res.end(JSON.stringify({ models: [{ name: 'test-model' }] }));
    let text = ''; for await (const chunk of req) text += chunk; request = JSON.parse(text);
    if (request.messages[0].content === 'fail') { res.statusCode = 500; return res.end('{"error":"test"}'); }
    res.end(JSON.stringify({ message: { content: '{"ok":true}' }, prompt_eval_count: 12, eval_count: 5 }));
  });
  await new Promise(r => mock.listen(0, '127.0.0.1', r));
  const oldURL = process.env.OLLAMA_URL, oldModel = process.env.OLLAMA_MODEL;
  process.env.OLLAMA_URL = `http://127.0.0.1:${mock.address().port}`; process.env.OLLAMA_MODEL = 'test-model';
  try {
    assert.equal((await ollamaStatus()).installed, true);
    const out = await ollamaChat([{ role: 'user', content: 'test' }], { seed: 17, schema: { type: 'object' } });
    assert.equal(request.options.seed, 17); assert.equal(request.format.type, 'object'); assert.equal(request.think, false);
    assert.equal(request.options.num_ctx, Number(process.env.LLM_CONTEXT_LENGTH || 8192));
    assert.equal(out.tokensOut, 5); assert.equal(out.raw, '{"ok":true}');
    await assert.rejects(() => ollamaChat([{ role: 'user', content: 'fail' }]), /HTTP 500/);
  } finally {
    if (oldURL === undefined) delete process.env.OLLAMA_URL; else process.env.OLLAMA_URL = oldURL;
    if (oldModel === undefined) delete process.env.OLLAMA_MODEL; else process.env.OLLAMA_MODEL = oldModel;
    await new Promise(r => mock.close(r));
  }
});
test('metrics keep failures in denominator and censor repair-to-success for failures', () => {
  const good = { report: { schemaValid: true, playable: true, passed: true, rules: [{ passed: true }] }, level: makeDemo(42) };
  const bad = { report: { schemaValid: false, playable: false, passed: false, rules: [] }, level: null };
  const result = summarize([{ mode: 'none', attempts: [good] }, { mode: 'none', attempts: [bad] }, { mode: 'none', attempts: [], error: 'offline' }])[0];
  assert.equal(result.successRate, 1 / 3); assert.equal(result.infrastructureErrors, 1);
  assert.equal(result.meanRepairsToSuccess, 0); assert.equal(result.censoredFailures, 2);
  assert.equal(result.diversitySuccessful, null);
});
