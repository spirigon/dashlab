import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {DEFAULT_REQUIREMENTS, solve, validate} from '../public/engine.js';
import {sectionPlan, compileSection, evaluateSection, sectionMessages, assembleSections} from '../src/sectioned-generator.js';
import {sectionWitness, randomSection} from '../src/sectioned-study.js';
const r = {...DEFAULT_REQUIREMENTS, minSpikes: 0, minBlocks: 0, minDoubleSpikes: 0, minJumps: 0};

test('four fixed intervals translate literally and end at the original full requirements', () => {
  const plan = sectionPlan(DEFAULT_REQUIREMENTS), prefix = [{type: 'spike', x: 8, w: 1, h: 1}];
  assert.equal(plan.length, 4); assert.deepEqual(plan[3].targets, DEFAULT_REQUIREMENTS);
  const input = JSON.stringify({objects: [{type: 'block', x: 0, w: 2, h: 1}]});
  const level = compileSection(input, prefix, plan[1]);
  assert.deepEqual(level.objects[0], prefix[0]); assert.notEqual(level.objects[0], prefix[0]);
  assert.equal(level.objects[1].x, plan[1].origin);
  assert.throws(() => compileSection(JSON.stringify({objects: [{type: 'spike', x: plan[1].localRightEdge - 1, w: 3, h: 1}]}), prefix, plan[1]), /SECTION_BOUNDS/);
});
test('two independently playable pieces can fail at the join; the whole prefix detects it', () => {
  const a = {type: 'spike', x: 14, w: 3, h: 1}, b = {type: 'block', x: 18, w: 1, h: 2};
  const map = objects => ({version: 1, name: 'Join fixture', length: 40, objects});
  assert.equal(solve(map([a])).passed, true); assert.equal(solve(map([b])).passed, true);
  const slot = {index: 1, origin: 18, localRightEdge: 15, targets: {...r, length: 40, safeStart: 0, safeFinish: 0}};
  const result = evaluateSection(JSON.stringify({objects: [{...b, x: 0}]}), [a], slot);
  assert.equal(result.accepted, false); assert.equal(result.report.playable, false);
  assert.ok(result.report.errors.some(e => e.code === 'NO_PATH'));
});
test('feedback arms share initial prompts, while only validator gets the failed execution report', () => {
  const item = {prompt: 'Test', requirements: r}, slot = sectionPlan(r)[0];
  assert.deepEqual(sectionMessages(item, [], slot, 'none'), sectionMessages(item, [], slot, 'validator'));
  const previous = [evaluateSection('{"objects":[{"type":"spike","x":1,"w":1,"h":2}]}', [], slot)];
  previous[0].raw = '{"objects":[{"type":"spike","x":1,"w":1,"h":2}]}';
  assert.match(sectionMessages(item, [], slot, 'validator', previous).messages.at(-1).content, /Exact current whole-prefix validator/);
  assert.doesNotMatch(sectionMessages(item, [], slot, 'none', previous).messages.at(-1).content, /height|SCHEMA|furthestX/);
});
test('failed section stops after three proposals and cannot masquerade as an empty successful whole level', async () => {
  let calls = 0;
  const result = await assembleSections({prompt: 'Test', requirements: r, seed: 1}, 'validator', async () => {
    calls++; return {raw: '{"objects":[]}'};
  });
  assert.equal(calls, 3); assert.equal(result.stages.length, 1); assert.equal(result.globalReport.passed, true);
  assert.equal(result.report.passed, false); assert.equal(result.assembly.complete, false);
});
test('all six task configurations have hidden valid four-stage witnesses and expose no witness fields', async () => {
  const tasks = JSON.parse(await readFile(new URL('../examples/briefs-sectioned.json', import.meta.url), 'utf8'));
  for (const task of tasks) {
    const witness = sectionWitness(task); assert.equal(validate(witness.level, task.requirements).passed, true);
    const item = {...task, seed: 10, witness};
    const prompt = sectionMessages(item, [], sectionPlan(task.requirements)[0], 'validator');
    assert.deepEqual(prompt, sectionMessages({...task, seed: 10}, [], sectionPlan(task.requirements)[0], 'validator'));
    let index = 0;
    const result = await assembleSections(item, 'validator', async () => ({raw: witness.stages[index++].raw}));
    assert.equal(index, 4); assert.equal(result.report.passed, true); assert.equal(result.assembly.complete, true);
  }
});
test('random section proposals reproduce exactly and consume no model calls', () => {
  const item = {requirements: DEFAULT_REQUIREMENTS, seed: 10}, slot = sectionPlan(item.requirements)[0];
  assert.deepEqual(randomSection(item, [], slot, 0), randomSection(item, [], slot, 0));
});
