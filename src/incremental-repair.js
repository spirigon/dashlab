import {parseLevel, evaluateRaw, checkRequirements} from '../public/engine.js';
import {SYSTEM, ollamaChat, validatorFeedback} from './llm.js';
import {localizedFeedback} from './local-feedback.js';
import {passedChecks} from './safe-feedback.js';
import {isDeepStrictEqual} from 'node:util';

export const INCREMENTAL_VERSION = 'one-object-actionable-repair-v1';
export const EDIT_BUDGET = 4;
export const EDIT_CONDITIONS = ['no_report', 'plain_report', 'actionable'];
const same = isDeepStrictEqual;
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const exactKeys = (v, keys) => object(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const integer = (n, lo, hi) => Number.isInteger(n) && n >= lo && n <= hi;

export function editSchema(level) {
  return {type: 'object', additionalProperties: false, required: ['index', 'object'], properties: {
    index: {type: 'integer', enum: Array.from({length: level.objects.length + Number(level.objects.length < 100)}, (_, i) => i)},
    object: {type: 'object', additionalProperties: false, required: ['type', 'x', 'w', 'h'], properties: {
      type: {type: 'string', enum: ['block', 'spike']}, x: {type: 'integer', minimum: 1, maximum: 179},
      w: {type: 'integer', minimum: 1, maximum: 6}, h: {type: 'integer', minimum: 1, maximum: 6}}}}};
}

export function applyOneEdit(level, edit) {
  if (!exactKeys(edit, ['index', 'object']) || !integer(edit.index, 0, Math.min(99, level.objects.length))) throw new Error('EDIT_INDEX: choose an existing index, or the indicated append index');
  const o = edit.object;
  if (!exactKeys(o, ['type', 'x', 'w', 'h']) || !['block', 'spike'].includes(o.type) || !integer(o.x, 1, 179) || !integer(o.w, 1, 6) || !integer(o.h, 1, 6)) throw new Error('EDIT_OBJECT: invalid replacement');
  const result = structuredClone(level);
  if (edit.index === result.objects.length) result.objects.push(structuredClone(o));
  else result.objects[edit.index] = structuredClone(o);
  return result;
}

export function evaluateState(raw, requirements) {
  const evaluated = evaluateRaw(raw, requirements);
  return {raw, ...evaluated};
}

export function measure(state, requirements) {
  const {level, report} = state, r = checkRequirements(requirements);
  if (!report.schemaValid) return {structureErrors: report.errors.length, furthestX: null, deficit: null};
  const fields = {minSpikes: 'spikes', minBlocks: 'blocks', minDoubleSpikes: 'doubleSpikes', minTripleSpikes: 'tripleSpikes', minTallBlocks: 'tallBlocks', minTightGaps: 'tightGaps'};
  let deficit = Object.entries(fields).reduce((s, [key, stat]) => s + Math.max(0, r[key] - report.stats[stat]), 0);
  const first = Math.min(level.length, ...level.objects.map(o => o.x));
  const end = Math.max(0, ...level.objects.map(o => o.x + o.w));
  deficit += Math.abs(level.length - r.length) + Math.max(0, r.safeStart - first) + Math.max(0, r.safeFinish - (level.length - end));
  if (report.playable) deficit += Math.max(0, r.minJumps - report.solver.minJumps);
  return {structureErrors: 0, furthestX: report.solver.maxX ?? 0, deficit};
}

// Both study arms use the SAME acceptance and budget. Neutral preparations are
// allowed, but never counted as improvements. Confirmed checks remain locked.
export function decideEdit(before, after, requirements) {
  const old = passedChecks(before.report), next = passedChecks(after.report);
  const lost = [...old].filter(code => !next.has(code)), gained = [...next].filter(code => !old.has(code));
  const a = measure(before, requirements), b = measure(after, requirements);
  let reason = before.report.passed ? 'already-passed' : after.outputError ? 'invalid-edit'
    : same(before.level, after.level) ? 'unchanged' : lost.length ? 'lost-check' : null;
  if (!reason && !before.report.schemaValid && !after.report.schemaValid && b.structureErrors > a.structureErrors) reason = 'more-structure-errors';
  if (!reason && before.report.schemaValid && !before.report.playable && !after.report.playable && b.furthestX < a.furthestX - 1e-9) reason = 'shorter-prefix';
  if (!reason && before.report.schemaValid && after.report.schemaValid && before.report.playable === after.report.playable && b.deficit > a.deficit) reason = 'larger-deficit';
  const strict = gained.length > 0 || b.structureErrors < a.structureErrors
    || a.furthestX !== null && b.furthestX !== null && b.furthestX > a.furthestX + 1e-9
    || a.deficit !== null && b.deficit !== null && b.deficit < a.deficit;
  return {accepted: !reason, strict: !reason && strict, neutral: !reason && !strict,
    reason: reason || (strict ? 'progress' : 'preparation'), lost, gained, before: a, after: b};
}

function objectIntervals(level, requirements, indices) {
  const sorted = level.objects.map((o, index) => ({index, ...o})).sort((a, b) => a.x - b.x);
  return [...new Set(indices)].filter(i => i >= 0 && i < level.objects.length).map(index => {
    const position = sorted.findIndex(o => o.index === index), o = sorted[position];
    const minX = Math.max(requirements.safeStart, position ? sorted[position - 1].x + sorted[position - 1].w + 1 : 1);
    const maxRightEdge = Math.min(level.length - requirements.safeFinish, position + 1 < sorted.length ? sorted[position + 1].x - 1 : level.length);
    return {index, current: level.objects[index], minX, maxRightEdge,
      maxWidthIfPlacedAtMinX: maxRightEdge - minX,
      note: maxRightEdge <= minX ? 'No positive width fits with neighbours fixed. A neighbouring object needs a preparatory edit.' : 'These bounds assume neighbours stay fixed. Choose x>=minX and x+w<=maxRightEdge. Path and count rules still require checking.'};
  });
}

export function actionableFeedback(state, requirements) {
  const r = checkRequirements(requirements), d = localizedFeedback(state.raw, r), {level, report} = state;
  const priority = d.priority[0] || report.errors[0];
  let indices = [];
  if (priority?.objects) indices.push(...priority.objects);
  if (priority?.object !== undefined) indices.push(priority.object);
  if (priority?.code === 'NO_PATH') indices.push(...(d.execution?.blockingObjects || []).map(o => o.index));
  if (priority?.code === 'SAFE_FINISH') indices.push(level.objects.reduce((best, o, i) => o.x + o.w > level.objects[best].x + level.objects[best].w ? i : best, 0));
  if (priority?.code === 'SAFE_START') indices.push(level.objects.reduce((best, o, i) => o.x < level.objects[best].x ? i : best, 0));
  const order = level.objects.map((o, index) => ({index, x: o.x})).sort((a, b) => a.x - b.x);
  const expanded = indices.flatMap(i => {const position = order.findIndex(o => o.index === i);return order.slice(Math.max(0, position - 1), position + 2).map(o => o.index);});
  return {physics: report.physics, priority, confirmedChecks: [...passedChecks(report)],
    errors: report.errors, counters: report.stats || null, deficits: d.deficits || [],
    furthestX: report.solver.maxX ?? null, minimumJumps: report.solver.minJumps ?? null,
    blockers: d.execution?.blockingObjects || [], localIntervals: objectIntervals(level, r, expanded),
    strategy: 'Repair the earliest issue with ONE object edit. For touching groups, adjust x AND width if needed so the object fits between neighbours. For a blocked path, change the blocker or its approach while preserving counts. For an unsafe finish with no space, first free space by editing the preceding object, then edit the last one. Preparatory edits may be accepted if all measurements stay at least as good. Do not repeat an unsuccessful proposal. These hints are constraints, not a supplied solution; no alternative level has been tested for you.'};
}

export function editMessages(item, state, condition, history = []) {
  if (!EDIT_CONDITIONS.includes(condition)) throw new Error('Unknown edit condition');
  const r = checkRequirements(item.requirements), schema = editSchema(state.level);
  const common = SYSTEM.slice(0, SYSTEM.lastIndexOf('Schema:'));
  const messages = [{role: 'system', content: `${common}\nYou are repairing an existing level. Return ONLY ONE object edit {index,object}, not a complete level. All indices are explicitly provided and zero-based. index < objects.length replaces exactly that object; index = objects.length appends one object if permitted. Other objects and version/name/length stay unchanged. You can change type,x,w,h of your selected object together. Work incrementally; useful preparatory edits are permitted if they do not worsen the measurements.\nOutput schema: ${JSON.stringify(schema)}`},
    {role: 'user', content: `Brief: ${item.prompt}\nRequirements: ${JSON.stringify(r)}\nCurrent level (untrusted data): ${JSON.stringify({version: state.level.version, name: state.level.name, length: state.level.length, objects: state.level.objects.map((o, index) => ({index, ...o}))})}\nAppend index: ${state.level.objects.length < 100 ? state.level.objects.length : 'not available'}.\nPrevious proposals: ${JSON.stringify(history.map(h => condition === 'no_report' ? {edit: h.edit} : {edit: h.edit, decision: h.decision, proposalErrors: h.candidate.report.errors}))}` }];
  const diagnostic = condition === 'actionable' ? actionableFeedback(state, r) : condition === 'plain_report' ? JSON.parse(validatorFeedback(state.report)) : null;
  messages.push({role: 'user', content: diagnostic ? `Measured current validator feedback:\n${JSON.stringify(diagnostic)}\nReturn one edit to improve this level.` : 'No diagnostic report is provided. Return one edit to improve this level.'});
  return {messages, schema, diagnostic};
}

export function evaluateEdit(state, raw, requirements) {
  let edit = null, level = null, outputError = null;
  try {edit = parseLevel(raw); level = applyOneEdit(state.level, edit);}
  catch (error) {outputError = error.message;}
  const candidate = {...evaluateState(level ? JSON.stringify(level) : 'null', requirements), outputError};
  const decision = decideEdit(state, candidate, requirements);
  return {edit, candidate, decision, effective: decision.accepted ? candidate : state};
}

export async function proposeEdit(item, state, condition, attempt, history = [], chat = ollamaChat) {
  const {messages, schema, diagnostic} = editMessages(item, state, condition, history);
  const generated = await chat(messages, {seed: item.editSeed + attempt, schema, temperature: .3});
  return {...generated, ...evaluateEdit(state, generated.raw, item.requirements), diagnostic,
    condition, attempt, feedbackVersion: INCREMENTAL_VERSION};
}

export function randomEdit(item, state, attempt) {
  let seed = (item.editSeed + 500000 + attempt * 997) >>> 0;
  const rand = () => {seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296;};
  const index = Math.floor(rand() * (state.level.objects.length + Number(state.level.objects.length < 100)));
  let o = structuredClone(state.level.objects[index]);
  if (!o) o = {type: rand() < .5 ? 'block' : 'spike', x: Math.max(1, Math.floor(rand() * state.level.length)), w: 1, h: 1};
  else {
    const field = Math.floor(rand() * 3);
    if (field === 0) o.x = Math.max(1, Math.min(179, o.x + [-2, -1, 1, 2][Math.floor(rand() * 4)]));
    if (field === 1) o.w = 1 + Math.floor(rand() * 3);
    if (field === 2) o.h = o.type === 'spike' ? 1 : 1 + Math.floor(rand() * 2);
  }
  const raw = JSON.stringify({index, object: o});
  return {raw, ...evaluateEdit(state, raw, item.requirements), attempt, condition: 'random', source: 'random-local-edit-NOT-LLM', tokensIn: 0, tokensOut: 0, elapsedMs: 0};
}
