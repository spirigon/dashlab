import test from 'node:test';
import assert from 'node:assert/strict';
import { schemaErrors, checkRequirements, solve, replay, validate, makeDemo, evaluateRaw, diversity } from '../public/engine.js';
const empty = { version: 1, name: 'Test', length: 24, objects: [] };

test('empty ground has a zero-jump path, and an actual wall has none', () => {
  assert.equal(solve(empty).minJumps, 0);
  const wall = { ...empty, objects: [{ type: 'block', x: 7, w: 1, h: 6 }] };
  const result = solve(wall);
  assert.equal(result.status, 'unreachable'); assert.ok(result.maxX < 8);
});
test('separated hazards require two jumps; returned inputs survive independent replay', () => {
  const level = { ...empty, objects: [{ type: 'spike', x: 7, w: 2, h: 1 }, { type: 'spike', x: 17, w: 1, h: 1 }] };
  const result = solve(level);
  assert.equal(result.minJumps, 2); assert.ok(replay(level, result.jumpTicks).passed);
  assert.equal(replay(level, []).passed, false);
  assert.equal(replay(level, result.jumpTicks.slice(0, 1)).passed, false);
});
test('schema rejects overlaps, bounds, malformed objects, NaN and unrecognized fields', () => {
  for (const level of [null, [], { ...empty, version: '1' }, { ...empty, length: NaN },
    { ...empty, hidden: true }, { ...empty, objects: [null] },
    { ...empty, objects: [{ type: 'spike', x: 23, w: 2, h: 1 }] },
    { ...empty, objects: [{ type: 'spike', x: 4, w: 1, h: 2 }] },
    { ...empty, objects: [{ type: 'block', x: 4, w: 2, h: 1 }, { type: 'spike', x: 5, w: 1, h: 1 }] },
  ]) assert.ok(schemaErrors(level).length);
});
test('requirements are external and cannot be silently relaxed by a level', () => {
  assert.throws(() => checkRequirements({ length: 24, safeStart: 20, safeFinish: 20 }));
  assert.throws(() => checkRequirements({ minCoins: 3 }));
  const r = validate(empty, { length: 24, minSpikes: 1, minBlocks: 0, minDoubleSpikes: 0, minJumps: 0 });
  assert.equal(r.playable, true); assert.equal(r.passed, false);
  assert.ok(r.errors.some(e => e.code === 'SPIKES'));
  // Splitting one continuous block into multiple JSON groups cannot inflate counts.
  assert.ok(schemaErrors({ ...empty, objects: [{ type: 'block', x: 7, w: 1, h: 1 }, { type: 'block', x: 8, w: 1, h: 1 }] }).some(e => e.code === 'ADJACENT_GROUPS'));
});
test('budget exhaustion is unknown, never reported as proof of impossibility', () => {
  assert.equal(solve(empty, { maxStates: 1 }).status, 'inconclusive');
  assert.equal(validate(empty, { length: 24 }, { maxStates: 1 }).rules.find(r => r.code === 'MIN_JUMPS').passed, null);
});

test('challenge requirements cannot be satisfied by deleting triples, lowering blocks or spreading groups', () => {
  const base = { length: 40, minSpikes: 0, minBlocks: 0, minDoubleSpikes: 0, minJumps: 0, safeStart: 0, safeFinish: 0 };
  const stairs = { version: 1, name: 'Stairs', length: 40, objects: [
    { type: 'block', x: 13, w: 2, h: 2 }, { type: 'block', x: 9, w: 2, h: 1 },
  ] };
  assert.equal(validate(stairs, { ...base, minTallBlocks: 1, minTightGaps: 1 }).passed, true);
  const lowered = { ...stairs, objects: stairs.objects.map(o => ({ ...o, h: 1 })) };
  assert.ok(validate(lowered, { ...base, minTallBlocks: 1 }).errors.some(e => e.code === 'TALL_BLOCKS'));
  const spread = { ...stairs, objects: stairs.objects.map(o => ({ ...o, x: o.x === 13 ? 18 : o.x })) };
  assert.ok(validate(spread, { ...base, minTightGaps: 1 }).errors.some(e => e.code === 'TIGHT_GAPS'));
  const triple = { ...stairs, objects: [{ type: 'spike', x: 9, w: 3, h: 1 }] };
  assert.equal(validate(triple, { ...base, minTripleSpikes: 1 }).passed, true);
  assert.ok(validate({ ...triple, objects: [{ ...triple.objects[0], w: 2 }] }, { ...base, minTripleSpikes: 1 }).errors.some(e => e.code === 'TRIPLE_SPIKES'));
  assert.equal(validate(stairs, base).rules.length, 7); // Old tasks retain the seven original rules.
});
test('demo is deterministic and successful fixture passes every requirement', () => {
  assert.deepEqual(makeDemo(42), makeDemo(42));
  assert.notDeepEqual(makeDemo(42), makeDemo(43));
  assert.equal(validate(makeDemo(42)).passed, true);
  assert.equal(validate(makeDemo(42, undefined, true)).playable, false);
});
test('parse failures remain failures; diversity has a meaningful empty case', () => {
  assert.equal(evaluateRaw('{bad', {}).report.errors[0].code, 'JSON_PARSE');
  assert.equal(evaluateRaw('```json\n' + JSON.stringify(empty) + '\n```', { length: 24 }).report.schemaValid, true);
  assert.equal(diversity([empty]), null); assert.equal(diversity([empty, empty]), 0);
  assert.ok(diversity([makeDemo(42), makeDemo(43)]) > 0);
});
