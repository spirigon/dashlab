import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {sectionPlan} from '../src/sectioned-generator.js';
import {finalWitness} from '../src/section-final-study.js';
import {assembleFinalSections} from '../src/section-plan-final.js';
import {METHODS, CONDITIONS, sweepCases, evaluateGlobal, globalMessages, stagedSweepMessages, compactFeedback, actionHints, runSweepChain, summarizeSweep} from '../src/feedback-sweep.js';
const tasks = JSON.parse(await readFile(new URL('../examples/briefs-sectioned.json', import.meta.url), 'utf8'));
const item = {...tasks[0], task: tasks[0].id, seed: 301000}, witness = finalWitness(item);
const raw = JSON.stringify(Object.fromEntries(witness.stages.map((s, i) => ['s' + (i + 1), JSON.parse(s.raw)])));

test('sweep has 360 fixed assignments and fresh, unique seeds', () => {
  const cases = sweepCases(tasks); assert.equal(cases.length, 36); assert.equal(new Set(cases.map(c => c.seed)).size, 36);
  assert.equal(cases.length * METHODS.length * CONDITIONS.length, 360); assert.equal(cases[0].seed, 301000);
});
test('all four feedback treatments share each initial request', () => {
  for (const condition of ['exact', 'compact', 'actionable']) {
    assert.deepEqual(globalMessages(item, condition), globalMessages(item, 'none'));
    const slot = sectionPlan(item.requirements)[0];
    assert.deepEqual(stagedSweepMessages(item, [], slot, condition, []), stagedSweepMessages(item, [], slot, 'none', []));
  }
});
test('joint compiler checks exact complete geometry against original constraints', () => {
  const result = evaluateGlobal(raw, item.requirements); assert.ok(result.accepted);
  assert.deepEqual(result.level.objects, witness.level.objects); assert.ok(result.report.solver.minJumps >= item.requirements.minJumps);
  const bad = JSON.parse(raw); bad.s1.pairs[0] = 'unknown'; assert.equal(evaluateGlobal(JSON.stringify(bad), item.requirements).level, null);
  delete bad.s4; assert.equal(evaluateGlobal(JSON.stringify(bad), item.requirements).report.passed, false);
});
test('global feedback is measured, format-specific, and does not alter requirements', () => {
  const harder = {...item, requirements: {...item.requirements, minSpikes: 100}};
  const failed = {...evaluateGlobal(raw, harder.requirements), raw};
  const compact = compactFeedback(failed, harder.requirements, sectionPlan(harder.requirements));
  assert.ok(compact.deficits.some(d => d.counter === 'spikes' && d.missing > 0));
  assert.ok(actionHints(compact).some(s => s.includes('stairs -> tower_triple')));
  assert.ok(!globalMessages(harder, 'none', [failed]).messages.at(-1).content.includes('missing'));
  assert.ok(globalMessages(harder, 'compact', [failed]).messages.at(-1).content.includes('missing'));
  assert.ok(globalMessages(harder, 'actionable', [failed]).messages.at(-1).content.includes('Static edit options'));
  assert.ok(globalMessages(harder, 'exact', [failed]).messages.at(-1).content.includes('Exact validator'));
});
test('global no-path feedback locates failed section from actual search', () => {
  const candidate = {report: {errors: [{code: 'NO_PATH'}], stats: {}, playable: false, solver: {maxX: 30}}};
  const feedback = compactFeedback(candidate, item.requirements, sectionPlan(item.requirements));
  assert.equal(feedback.failure.section, 2); assert.ok(actionHints(feedback).some(h => h.includes('x=30')));
});
test('global stops after first success and does not call for random proposals', async () => {
  let calls = 0;
  const result = await runSweepChain(item, 'global', 'actionable', async () => {calls++; return {raw};});
  assert.equal(calls, 1); assert.equal(result.passed, true); assert.equal(result.attempts.length, 1);
  const random = await runSweepChain(item, 'global', 'random', () => {throw new Error('Random must not call model');});
  assert.ok(random.attempts.length >= 1 && random.attempts.length <= 4);
});
test('global cap, error denominator and failed output are retained', async () => {
  let calls = 0;
  const failed = await runSweepChain(item, 'global', 'compact', async () => {calls++; return {raw: '{}'};});
  assert.equal(calls, 4); assert.equal(failed.passed, false); assert.equal(failed.attempts.length, 4); assert.equal(failed.level, null);
  const error = await runSweepChain(item, 'global', 'compact', async () => {throw new Error('Actual API failure');});
  assert.equal(error.passed, false); assert.equal(error.error, 'Actual API failure');
  const summary = summarizeSweep([{caseId: 'x', method: 'global', condition: 'compact', result: error}], [{id: 'x', task: item.task}]);
  assert.equal(summary.summary.find(s => s.method === 'global' && s.condition === 'compact').infrastructureErrors, 1);
});
test('original staged none/exact chains match deployed generator', async () => {
  for (const [sweep, deployed] of [['none', 'none'], ['exact', 'validator']]) {
    const seen = [], replayed = [];
    const actual = await runSweepChain(item, 'staged', sweep, async (messages, options, local) => {
      seen.push({messages, options}); return {raw: witness.stages[local.stage].raw};
    });
    const old = await assembleFinalSections(item, deployed, async (messages, options) => {
      replayed.push({messages, options}); return {raw: witness.stages[Math.floor((options.seed - item.seed) / 100)].raw};
    });
    assert.deepEqual(seen, replayed); assert.deepEqual(actual.level.objects, old.level.objects); assert.equal(actual.passed, old.report.passed);
  }
});
test('staged rejects partial map and locks accepted prefix', async () => {
  let calls = 0;
  const result = await runSweepChain(item, 'staged', 'actionable', async (messages, options, local) => {
    calls++; return {raw: local.stage === 0 ? witness.stages[0].raw : '{}'};
  });
  assert.equal(calls, 4); assert.equal(result.completedSections, 1); assert.equal(result.passed, false);
  assert.deepEqual(result.stages[1].prefix, result.level.objects);
});
