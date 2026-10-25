import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {validate} from '../public/engine.js';
import {sectionPlan} from '../src/sectioned-generator.js';
import {evaluateSectionPlan, geometricCounts, sectionPlanMessages, assembleSectionPlans} from '../src/section-plan-generator.js';
import {planWitness, randomPlanSection} from '../src/section-plan-study.js';
const tasks = JSON.parse(await readFile(new URL('../examples/briefs-sectioned.json', import.meta.url), 'utf8'));

test('plan choices expand literally and rejection never substitutes a valid plan', () => {
  const task = tasks[0], slot = sectionPlan(task.requirements)[0];
  const bad = evaluateSectionPlan('{"pairs":["stairs"],"extra":"none"}', [], slot, task.requirements);
  assert.equal(bad.accepted, false); assert.equal(bad.level.objects.filter(o => o.type === 'spike').length, 0);
  const good = evaluateSectionPlan('{"pairs":["tower_triple"],"extra":"none"}', [], slot, task.requirements);
  assert.equal(good.accepted, true); assert.equal(good.level.objects[0].x, slot.origin);
  assert.deepEqual(geometricCounts(good.level.objects), good.report.stats);
});
test('residual counts are common planning information; rejected-plan reports remain isolated', () => {
  const task = tasks[0], slots = sectionPlan(task.requirements);
  const first = evaluateSectionPlan('{"pairs":["tower_triple"],"extra":"none"}', [], slots[0], task.requirements);
  const prefix = first.level.objects;
  const a = sectionPlanMessages(task, prefix, slots[1], 'none'), b = sectionPlanMessages(task, prefix, slots[1], 'validator');
  assert.deepEqual(a, b); assert.match(a.messages[1].content, /NEW-SECTION additional geometric counts/);
  assert.match(a.messages[1].content, /"minBlocks":1/);
  const raw = '{"pairs":["stairs"],"extra":"none"}', previous = [{raw, ...evaluateSectionPlan(raw, [], slots[0], task.requirements)}];
  assert.match(sectionPlanMessages(task, [], slots[0], 'validator', previous).messages.at(-1).content, /Exact failed-plan feedback/);
  assert.doesNotMatch(sectionPlanMessages(task, [], slots[0], 'none', previous).messages.at(-1).content, /"missing"|Exact failed-plan/);
});
test('all task witnesses complete literal four-section plans, and random uses the same compiler', async () => {
  for (const task of tasks) {
    const witness = planWitness(task); let stage = 0;
    const result = await assembleSectionPlans({...task, seed: 1}, 'validator', async () => ({raw: witness.stages[stage++].raw}));
    assert.equal(stage, 4); assert.equal(result.report.passed, true); assert.equal(validate(result.level, task.requirements).passed, true);
    const slot = sectionPlan(task.requirements)[0], random = randomPlanSection({...task, seed: 10}, [], slot, 0);
    const repeated = evaluateSectionPlan(random.raw, [], slot, task.requirements);
    for (const key of ['level', 'report', 'plan', 'rawObjects', 'accepted']) assert.deepEqual(random[key], repeated[key]);
  }
});
