import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {sectionPlan} from '../src/sectioned-generator.js';
import {evaluateFinalSection, assembleFinalSections} from '../src/section-plan-final.js';
import {finalWitness} from '../src/section-final-study.js';
const tasks = JSON.parse(await readFile(new URL('../examples/briefs-sectioned.json', import.meta.url), 'utf8'));
test('intermediate quota shortfall is allowed, while the original final requirements remain mandatory', () => {
  const task = tasks[0], slots = sectionPlan(task.requirements);
  const partial = evaluateFinalSection('{"pairs":["stairs"],"extra":"none"}', [], slots[0], task.requirements);
  assert.equal(partial.planningReport.passed, false); assert.equal(partial.accepted, true);
  assert.equal(partial.report.playable, true);
  const incomplete = evaluateFinalSection('{"pairs":["stairs"],"extra":"none"}', [], slots[3], task.requirements);
  assert.equal(incomplete.accepted, false); assert.ok(incomplete.report.errors.some(e => e.code === 'SPIKES'));
});
test('all hidden final witnesses satisfy full original requirements after exactly four model proposals', async () => {
  for (const task of tasks) {
    const witness = finalWitness(task); let index = 0;
    const result = await assembleFinalSections({...task, seed: 1}, 'validator', async (_, options) => {
      assert.equal(options.temperature, .65); return {raw: witness.stages[index++].raw};
    });
    assert.equal(index, 4); assert.equal(result.report.passed, true); assert.equal(result.assembly.complete, true);
  }
});
