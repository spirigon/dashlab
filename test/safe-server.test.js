import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {server} from '../src/server.js';
import {makeDemo, DEFAULT_REQUIREMENTS as requirements} from '../public/engine.js';

test('HTTP safe mode exposes the proposal separately, stops at full success, and rejects unsupported geometry', async () => {
  let calls = 0, actualRequest;
  const fake = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    actualRequest = JSON.parse(body);
    calls++;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({message: {content: '{}'}, prompt_eval_count: 10, eval_count: 2, done_reason: 'stop'}));
  });
  await new Promise(resolve => fake.listen(0, '127.0.0.1', resolve));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const old = process.env.OLLAMA_URL;
  process.env.OLLAMA_URL = `http://127.0.0.1:${fake.address().port}`;
  const post = body => fetch(`http://127.0.0.1:${server.address().port}/api/generate`, {
    method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
  try {
    const previous = JSON.stringify(makeDemo(42, requirements, true));
    const input = {prompt: 'Test', requirements, mode: 'safe', seed: 42, geometry: 'ground', previous};
    const response = await post(input), result = await response.json();
    assert.equal(response.status, 200); assert.equal(calls, 1);
    assert.match(actualRequest.messages.at(-1).content, /Exact proxy validator output/);
    assert.equal(result.raw, previous); assert.equal(result.candidate.raw, '{}');
    assert.equal(result.acceptance.accepted, false);
    const skipped = await (await post({...input, previous: JSON.stringify(makeDemo(42))})).json();
    assert.equal(skipped.skipped, true); assert.equal(calls, 1);
    assert.equal((await post({...input, geometry: 'elevated'})).status, 400);
    assert.equal(calls, 1);
  } finally {
    if (old === undefined) delete process.env.OLLAMA_URL; else process.env.OLLAMA_URL = old;
    await new Promise(resolve => server.close(resolve));
    await new Promise(resolve => fake.close(resolve));
  }
});
