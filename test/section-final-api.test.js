import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {server} from '../src/server.js';
import {finalWitness as sectionWitness} from '../src/section-final-study.js';

test('HTTP generation builds sections with global requirements at the final stage and rejects unsupported inputs before inference', async () => {
  const tasks = JSON.parse(await readFile(new URL('../examples/briefs-sectioned.json', import.meta.url), 'utf8'));
  const task = tasks[0], witness = sectionWitness(task); let calls = 0;
  const mock = createServer(async (req, res) => {
    let text = ''; for await (const chunk of req) text += chunk;
    const body = JSON.parse(text), stage = Number(body.messages[1].content.match(/Stage (\d)\/4/)[1]) - 1;
    calls++; res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({message: {content: witness.stages[stage].raw}, done_reason: 'stop', eval_count: 100}));
  });
  await new Promise(resolve => mock.listen(0, '127.0.0.1', resolve));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const previous = process.env.OLLAMA_URL; process.env.OLLAMA_URL = `http://127.0.0.1:${mock.address().port}`;
  const post = input => fetch(`http://127.0.0.1:${server.address().port}/api/generate`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(input)});
  const input = {prompt: task.prompt, requirements: task.requirements, seed: 1000, mode: 'sectioned', geometry: 'ground', sectionFeedback: 'validator', sectionRepresentation: 'plans'};
  try {
    const response = await post(input), result = await response.json();
    assert.equal(response.status, 200); assert.equal(result.assembly.completedSections, 4); assert.equal(result.report.passed, true); assert.equal(calls, 4);
    assert.equal((await post({...input, geometry: 'elevated'})).status, 400);
    assert.equal((await post({...input, previous: result.raw})).status, 400);
    assert.equal((await post({...input, sectionFeedback: 'unknown'})).status, 400);
    assert.equal(calls, 4);
  } finally {
    if (previous === undefined) delete process.env.OLLAMA_URL; else process.env.OLLAMA_URL = previous;
    await new Promise(resolve => server.close(resolve)); await new Promise(resolve => mock.close(resolve));
  }
});
