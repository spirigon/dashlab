import test from 'node:test';
import assert from 'node:assert/strict';
import {acceptRepair, focusedFeedback, generateSafe} from '../src/safe-feedback.js';
import {makeDemo, evaluateRaw, DEFAULT_REQUIREMENTS as requirements} from '../public/engine.js';

const report = (rules, extras = {}) => ({schemaValid: true, playable: false, passed: false,
  rules: Object.entries(rules).map(([code, passed]) => ({code, passed})), ...extras});

test('a newly passed rule cannot compensate for a lost rule or a lost path', () => {
  const decision = acceptRepair(report({A: true, B: false}), report({A: false, B: true, C: true}));
  assert.equal(decision.accepted, false); assert.deepEqual(decision.lost, ['A']);
  assert.equal(acceptRepair(report({A: false}, {playable: true}), report({A: true})).accepted, false);
});
test('unknown or missing rules cannot masquerade as preservation', () => {
  for (const value of [null, false, undefined]) {
    const after = report(value === undefined ? {B: true} : {A: value, B: true});
    assert.equal(acceptRepair(report({A: true, B: false}), after).accepted, false);
  }
  assert.equal(acceptRepair(report({A: true}), report({}, {schemaValid: false})).accepted, false);
});
test('acceptance needs a strict gain, stops on success, and permits a complete repair', () => {
  const before = report({A: true, B: false});
  assert.equal(acceptRepair(before, before).reason, 'no-progress');
  assert.equal(acceptRepair(before, report({A: true, B: true}, {playable: true, passed: true})).accepted, true);
  assert.equal(acceptRepair({...before, passed: true}, before).reason, 'already-passed');
});
test('accepted outputs retain every confirmed check over a bounded exhaustive state space', () => {
  const values = [true, false, null];
  for (const a of values) for (const b of values) for (const c of values) for (const d of values) {
    const before = report({A: a, B: b}), after = report({A: c, B: d});
    const decision = acceptRepair(before, after);
    if (decision.accepted) {
      if (a === true) assert.equal(c, true);
      if (b === true) assert.equal(d, true);
      assert.ok([c, d].filter(v => v === true).length > [a, b].filter(v => v === true).length);
    }
  }
});
test('focused feedback exposes one measured priority, not a proposed corrected level', () => {
  const raw = JSON.stringify(makeDemo(42, requirements, true));
  const feedback = focusedFeedback(raw, requirements);
  assert.equal(feedback.target.code, 'NO_PATH');
  assert.ok(feedback.blockingObjects.length);
  assert.ok(!Object.hasOwn(feedback, 'recentStates'));
  assert.equal(focusedFeedback(JSON.stringify(makeDemo(42)), requirements), null);
});
test('safe generation keeps rejected raw data and separately records the actual model proposal', async () => {
  const previous = JSON.stringify(makeDemo(42, requirements, true));
  const result = await generateSafe({prompt: 'Test', requirements, previous}, async () => ({raw: '{}', tokensOut: 4, model: 'test'}));
  assert.equal(result.raw, previous); assert.equal(result.candidate.raw, '{}');
  assert.equal(result.acceptance.reason, 'regression'); assert.equal(result.tokensOut, 4);
  assert.deepEqual(result.report, evaluateRaw(previous, requirements).report);
});
test('safe generation skips fully successful input without invoking the model', async () => {
  let calls = 0;
  const previous = JSON.stringify(makeDemo(42));
  const result = await generateSafe({prompt: 'Test', requirements, previous}, async () => {calls++; throw new Error('Must not run');});
  assert.equal(calls, 0); assert.equal(result.raw, previous); assert.equal(result.skipped, true);
});
test('successful model repair is retained literally and inference errors propagate', async () => {
  const previous = JSON.stringify(makeDemo(42, requirements, true)), raw = JSON.stringify(makeDemo(42));
  const result = await generateSafe({prompt: 'Test', requirements, previous}, async () => ({raw}));
  assert.equal(result.raw, raw); assert.equal(result.report.passed, true); assert.equal(result.acceptance.accepted, true);
  await assert.rejects(() => generateSafe({prompt: 'Test', requirements, previous}, async () => {throw new Error('offline');}), /offline/);
});
