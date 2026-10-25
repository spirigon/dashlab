import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {generateIncremental} from '../src/incremental-generator.js';
import {server} from '../src/server.js';
import {DEFAULT_REQUIREMENTS} from '../public/engine.js';
import {targetedMessages, TARGETED_VERSION} from '../src/targeted-feedback.js';
import {evaluateState} from '../src/incremental-repair.js';

const requirements = {...DEFAULT_REQUIREMENTS, minSpikes: 0, minBlocks: 0, minDoubleSpikes: 0, minJumps: 0};
const initial = JSON.stringify({version: 1, name: 'Two walls', length: 80, objects: [10, 30].map(x => ({type: 'block', x, w: 1, h: 6}))});

test('interactive local edits retain an unfinished improvement and carry compact measured history to the next step', async () => {
  let calls = 0; const inputs = [];
  const chat = async (messages, options) => {
    inputs.push(messages); const index = calls++;
    assert.equal(options.temperature, .3);
    return {raw: JSON.stringify({index, object: {type: 'block', x: index ? 30 : 10, w: 1, h: 1}}), model: 'fixture'};
  };
  const first = await generateIncremental({prompt: 'Test', requirements, previous: initial, seed: 42}, chat);
  assert.equal(first.acceptance.accepted, true); assert.equal(first.report.playable, false);
  assert.ok(first.acceptance.after.furthestX > first.acceptance.before.furthestX);
  assert.ok(Array.isArray(JSON.parse(first.raw).objects)); assert.equal(JSON.parse(first.rawEdit).index, 0);
  const second = await generateIncremental({prompt: 'Test', requirements, previous: first.raw, editHistory: [first.editStep], seed: 43}, chat);
  assert.equal(second.report.passed, true); assert.equal(calls, 2);
  assert.match(inputs[1][1].content, /Previous proposals:.*furthestX/);
  const skipped = await generateIncremental({prompt: 'Test', requirements, previous: second.raw}, chat);
  assert.equal(skipped.skipped, true); assert.equal(calls, 2);
  await assert.rejects(() => generateIncremental({prompt: 'Test', requirements, previous: 'not json'}, chat), /нужен JSON/);
});

test('HTTP incremental mode applies a literal object edit and rejects unsupported geometry without inference', async () => {
  let calls = 0;
  const mock = createServer(async (req, res) => {
    let text = ''; for await (const chunk of req) text += chunk;
    const body = JSON.parse(text); calls++;
    assert.deepEqual(body.format.properties.index.enum, [0, 1, 2]);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({message: {content: '{"index":0,"object":{"type":"block","x":10,"w":1,"h":1}}'}, eval_count: 20, done_reason: 'stop'}));
  });
  await new Promise(resolve => mock.listen(0, '127.0.0.1', resolve));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const old = process.env.OLLAMA_URL; process.env.OLLAMA_URL = `http://127.0.0.1:${mock.address().port}`;
  const post = body => fetch(`http://127.0.0.1:${server.address().port}/api/generate`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
  try {
    const input = {prompt: 'Test', requirements, previous: initial, seed: 42, mode: 'incremental', geometry: 'ground'};
    const response = await post(input), result = await response.json();
    assert.equal(response.status, 200); assert.equal(calls, 1); assert.equal(result.acceptance.accepted, true);
    assert.equal(JSON.parse(result.raw).objects[0].h, 1); assert.equal(JSON.parse(result.raw).objects[1].h, 6);
    assert.equal((await post({...input, geometry: 'coins'})).status, 400); assert.equal(calls, 1);
  } finally {
    if (old === undefined) delete process.env.OLLAMA_URL; else process.env.OLLAMA_URL = old;
    await new Promise(resolve => server.close(resolve)); await new Promise(resolve => mock.close(resolve));
  }
});

test('interactive targeted feedback matches the frozen research interface and retains measured compact history', async () => {
  const history = []; let calls = 0, raw = initial;
  for (let step = 0; step < 2; step++) {
    const before = evaluateState(raw, requirements), seed = 100 + step;
    const expected = targetedMessages({prompt: 'Test', requirements, editSeed: seed}, before, 'targeted', history);
    const result = await generateIncremental({prompt: 'Test', requirements, previous: raw,
      seed, editHistory: history, feedbackStyle: 'targeted'}, async (messages, options) => {
      calls++; assert.deepEqual(messages, expected.messages); assert.deepEqual(options.schema, expected.schema);
      assert.equal(options.seed, seed);
      return {raw: JSON.stringify({index: step, object: {type: 'block', x: step ? 30 : 10, w: 1, h: 1}})};
    });
    assert.equal(result.feedbackVersion, TARGETED_VERSION); assert.equal(result.acceptance.accepted, true);
    history.push(result.editStep); raw = result.raw;
  }
  assert.equal(calls, 2); assert.equal(evaluateState(raw, requirements).report.passed, true);
  await assert.rejects(() => generateIncremental({requirements, feedbackStyle: 'unknown'}), /вариант/);
});
