import {checkRequirements, validate, parseLevel, PHYSICS} from '../public/engine.js';
import {sectionPlan, evaluateSection} from './sectioned-generator.js';
import {librarySection} from './sectioned-study.js';
import {ollamaChat} from './llm.js';

export const SECTION_PLAN_VERSION = 'four-section-library-plans-v1';
export const PAIRS = ['triple_pair', 'stairs', 'tower_triple'];
export const EXTRAS = {single_spike: {type: 'spike', w: 1, h: 1}, double_spike: {type: 'spike', w: 2, h: 1},
  triple_spike: {type: 'spike', w: 3, h: 1}, block: {type: 'block', w: 1, h: 1}, tall_block: {type: 'block', w: 1, h: 2}};
const COUNTERS = {minSpikes: 'spikes', minBlocks: 'blocks', minDoubleSpikes: 'doubleSpikes', minTripleSpikes: 'tripleSpikes', minTallBlocks: 'tallBlocks', minTightGaps: 'tightGaps'};
export function planShape(slot, r) {
  const delta = slot.targets.minJumps - Math.floor(r.minJumps * slot.index / 4);
  return {pairs: Math.floor(delta / 2), extra: delta % 2 === 1 || delta === 0};
}
export function planSectionSchema(slot, r) {
  const shape = planShape(slot, r);
  return {type: 'object', additionalProperties: false, required: ['pairs', 'extra'], properties: {
    pairs: {type: 'array', minItems: shape.pairs, maxItems: shape.pairs, items: {type: 'string', enum: PAIRS}},
    extra: {type: 'string', enum: shape.extra ? Object.keys(EXTRAS) : ['none']}}};
}
export function evaluateSectionPlan(raw, prefix, slot, requirements) {
  let plan = null, rawObjects = null;
  try {
    plan = parseLevel(raw); const shape = planShape(slot, requirements);
    if (!plan || Object.keys(plan).length !== 2 || !Array.isArray(plan.pairs) || plan.pairs.length !== shape.pairs || plan.pairs.some(p => !PAIRS.includes(p))
      || !(shape.extra ? Object.hasOwn(EXTRAS, plan.extra) : plan.extra === 'none')) throw new Error(`PLAN_SCHEMA: exactly ${shape.pairs} pairs and ${shape.extra ? 'one named extra obstacle' : 'extra=none'} are required`);
    rawObjects = librarySection(plan.pairs, plan.extra === 'none' ? null : EXTRAS[plan.extra]);
    return {...evaluateSection(rawObjects, prefix, slot), plan, rawObjects};
  } catch (e) {
    return {plan, rawObjects, level: null, accepted: false, outputError: e.message,
      report: {schemaValid: false, playable: false, passed: false, physics: PHYSICS.id, rules: [],
        errors: [{code: 'PLAN_SCHEMA', message: e.message}], solver: {status: 'invalid', jumpTicks: []}}};
  }
}
export function geometricCounts(prefix) {
  const spikes = prefix.filter(o => o.type === 'spike'), sorted = [...prefix].sort((a, b) => a.x - b.x);
  return {spikes: spikes.reduce((s, o) => s + o.w, 0), blocks: prefix.filter(o => o.type === 'block').length,
    doubleSpikes: spikes.filter(o => o.w >= 2).length, tripleSpikes: spikes.filter(o => o.w >= 3).length,
    tallBlocks: prefix.filter(o => o.type === 'block' && o.h >= 2).length,
    tightGaps: sorted.slice(1).filter((o, i) => {const gap = o.x - sorted[i].x - sorted[i].w; return gap >= 1 && gap <= 2;}).length};
}
const SYSTEM = `Build a Geometry Dash level from a SMALL FIXED LIBRARY, one of four sections at a time. Return ONLY {pairs:[...],extra:...} matching the schema. Choose types, not coordinates. The compiler expands your exact choices in order with 5 empty tiles after each pair, then the extra obstacle; no substitutions, count repair, search, or fallback. Local origin is 0, then the announced section offset is added. Whole-prefix search from x=0 checks every transition and the actual minimum jumps.
Contributions of ONE pair:
triple_pair: 6 spike tiles, 0 blocks, 2 double groups, 2 triple groups, 0 tall blocks, 1 tight gap, width 8.
stairs: 0 spikes, 2 blocks, 0 double/triple groups, 1 tall block, 1 tight gap, width 6.
tower_triple: 3 spike tiles, 1 block, 1 double group, 1 triple group, 1 tall block, 1 tight gap, width 6.
Each pair is intended to need two jumps. Extras: single_spike adds 1 spike; double_spike adds 2 spikes and 1 double group; triple_spike adds 3 spikes, 1 double and 1 triple group; block adds 1 block; tall_block adds 1 block and 1 tall block. A separate extra is intended to add one jump. Only actual search confirms jump counts. Names and enum values are literal.
The NEW-SECTION requirements below are residual counts: previous accepted objects have ALREADY been subtracted. Satisfy these additional counts with this section's choices. You do NOT need to repeat cumulative whole-level counts inside every new section. Never change accepted previous objects or original final requirements. Respect the required number of pairs, extra choice and maximum local right edge. A repeated rejected plan is not a useful revision.`;

export function planSectionFeedback(candidate, slot) {
  return {errors: candidate.report.errors, deficits: candidate.report.stats ? Object.entries(COUNTERS).filter(([key, stat]) => slot.targets[key] > candidate.report.stats[stat])
    .map(([key, stat]) => ({requirement: key, missing: slot.targets[key] - candidate.report.stats[stat]})) : null,
    actualMinimumJumps: candidate.report.solver.minJumps ?? null, furthestX: candidate.report.solver.maxX ?? null,
    instruction: 'Change pair types and/or the extra to fix these measured errors. Keep the schema; output no coordinates. No corrected plan has been supplied.'};
}
export function sectionPlanMessages(item, prefix, slot, condition, previous = []) {
  if (!['none', 'validator'].includes(condition)) throw new Error('Unknown plan feedback condition');
  const r = checkRequirements(item.requirements), counts = geometricCounts(prefix), schema = planSectionSchema(slot, r);
  const remaining = Object.fromEntries(Object.entries(COUNTERS).map(([key, stat]) => [key, Math.max(0, slot.targets[key] - counts[stat])]));
  const messages = [{role: 'system', content: `${SYSTEM}\nOutput schema: ${JSON.stringify(schema)}`},
    {role: 'user', content: `Brief: ${item.prompt}\nOriginal final requirements: ${JSON.stringify(r)}\nStage ${slot.index + 1}/4. Choose exactly ${schema.properties.pairs.minItems} pairs. Extra choices: ${schema.properties.extra.enum.join(', ')}.\nNEW-SECTION additional geometric counts: ${JSON.stringify(remaining)}\nCumulative minimum jumps target (whole prefix): ${slot.targets.minJumps}.\nMaximum local right edge: ${slot.localRightEdge}; compiler adds origin ${slot.origin}.\nPrevious accepted prefix objects: ${JSON.stringify(prefix)}`}];
  if (previous.length) messages.push({role: 'user', content: `Previous local plans: ${JSON.stringify(previous.map(a => a.raw))}\n${condition === 'validator'
    ? `Exact failed-plan feedback: ${JSON.stringify(planSectionFeedback(previous.at(-1), slot))}` : 'No rejected-plan diagnostic is provided. Return your own revised choices.'}`});
  return {messages, schema};
}
export async function proposeSectionPlan(item, prefix, slot, condition, attempt, previous = [], chat = ollamaChat) {
  const {messages, schema} = sectionPlanMessages(item, prefix, slot, condition, previous);
  const generated = await chat(messages, {seed: item.seed + slot.index * 100 + attempt, schema, temperature: .3});
  return {...generated, ...evaluateSectionPlan(generated.raw, prefix, slot, item.requirements), stage: slot.index, attempt,
    diagnostic: condition === 'validator' && previous.length ? planSectionFeedback(previous.at(-1), slot) : null};
}
export async function assembleSectionPlans(item, condition = 'validator', chat = ollamaChat, randomProposal) {
  if (!['none', 'validator', 'random'].includes(condition)) throw new Error('Unknown plan assembly condition');
  const r = checkRequirements(item.requirements), stages = []; let prefix = [], completedSections = 0, error = null;
  for (const slot of sectionPlan(r)) {
    const stage = {slot, prefix: structuredClone(prefix), attempts: [], accepted: false}; stages.push(stage);
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const result = condition === 'random' ? randomProposal(item, prefix, slot, attempt) : await proposeSectionPlan(item, prefix, slot, condition, attempt, stage.attempts, chat);
        stage.attempts.push(result);
        if (result.accepted) {prefix = result.level.objects; stage.accepted = true; completedSections++; break;}
      } catch (e) {error = e.message; break;}
    }
    if (!stage.accepted) break;
  }
  const level = {version: 1, name: 'Section plans level', length: r.length, objects: prefix}, globalReport = validate(level, r), complete = completedSections === 4;
  const report = {...globalReport, passed: complete && globalReport.passed, assemblyComplete: complete,
    rules: [...globalReport.rules, {code: 'ASSEMBLY_COMPLETE', passed: complete, message: `Собрано участков: ${completedSections} / 4`}],
    errors: complete ? globalReport.errors : [...globalReport.errors, {code: 'ASSEMBLY_COMPLETE', message: `Сборка остановлена: ${completedSections} / 4 участков`}]};
  const attempts = stages.flatMap(s => s.attempts);
  return {mode: 'sectioned', method: SECTION_PLAN_VERSION, raw: JSON.stringify(level), level, report, globalReport, stages, error,
    assembly: {completedSections, plannedSections: 4, complete, proposals: attempts.length, condition, representation: 'library-plans'},
    model: condition === 'random' ? 'random-library-sampler' : process.env.OLLAMA_MODEL || 'qwen3.5:4b',
    tokensIn: attempts.reduce((s, a) => s + (a.tokensIn || 0), 0), tokensOut: attempts.reduce((s, a) => s + (a.tokensOut || 0), 0), elapsedMs: attempts.reduce((s, a) => s + (a.elapsedMs || 0), 0)};
}
export async function generateSectionPlans(params, chat = ollamaChat) {
  if (params.previous !== undefined) throw new Error('Поэтапная сборка запускается с начала; нажмите «Сгенерировать».');
  const condition = params.sectionFeedback ?? 'validator';
  if (!['none', 'validator'].includes(condition)) throw new Error('Неизвестный вариант ОС для сборки.');
  return assembleSectionPlans({prompt: params.prompt, requirements: params.requirements, seed: params.seed ?? 42}, condition,
    (messages, options) => chat(messages, {...options, signal: params.signal}));
}
