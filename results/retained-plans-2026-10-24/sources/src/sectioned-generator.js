import {checkRequirements, validate, parseLevel, PHYSICS} from '../public/engine.js';
import {ollamaChat} from './llm.js';

export const SECTION_VERSION = 'four-section-prefix-validation-v1';
export const SECTION_COUNT = 4;
export const SECTION_ATTEMPTS = 3;
export const SECTION_CONDITIONS = ['none', 'validator', 'random'];
const COUNTERS = {minSpikes: 'spikes', minBlocks: 'blocks', minDoubleSpikes: 'doubleSpikes',
  minTripleSpikes: 'tripleSpikes', minTallBlocks: 'tallBlocks', minTightGaps: 'tightGaps'};
const exact = (o, keys) => o && typeof o === 'object' && !Array.isArray(o)
  && Object.keys(o).length === keys.length && keys.every(k => Object.hasOwn(o, k));
const integer = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;

export const SECTION_SYSTEM = `Build a Geometry Dash normal-cube level in FOUR consecutive sections. Return ONLY the current section JSON {objects:[{type,x,w,h},...]}. All x values are LOCAL to this section. The fixed compiler only translates x by the announced origin and appends these exact objects; it does not repair, delete, sort, clamp or add obstacles.
One tile is one block. Built-in solid ground, constant speed, normal gravity. Objects: spike with w=1..3 and h=1; block with w=1..3 and h=1..2. At least one empty tile between distinct groups. Keep x+w within the announced local right edge. No other object types, portals, gaps or triggers.
Proxy: speed ~10.39 tiles/sec, jump apex ~2.1 tiles, ground jump range ~4 tiles. Whole-prefix search, including transitions from previous sections, checks playability. A jump begins only while grounded. Geometry counts and minimum jumps are separate requirements.
Shared optional construction hints (not guaranteed solutions):
triple_pair: spike(x=0,w=3,h=1), spike(x=5,w=3,h=1), width 8.
stairs: block(x=0,w=2,h=1), block(x=4,w=2,h=2), width 6.
tower_triple: block(x=0,w=2,h=2), spike(x=3,w=3,h=1), width 6.
After a pair, 5 empty tiles before another pair often allow a fresh approach. A separate single/double/triple spike or a block can add an obstacle. These hints are available in every condition. You may create other local arrangements within the schema. Each pair is intended to require two jumps, but only the actual whole-prefix search decides.
Counters: spikes=sum spike widths; blocks=number of block objects; doubleSpikes=number of spike groups w>=2; tripleSpikes=number of spike groups w>=3; tallBlocks=number of blocks h>=2; tightGaps=number of consecutive gaps of 1 or 2 empty tiles. Widening an already double group does not add another double group. minJumps is minimized over ALL successful paths.
Keep every accepted previous object unchanged. Meet the cumulative targets at this stage. Original final requirements remain unchanged. No claims about completion in the actual game.`;

export function sectionPlan(requirements) {
  const r = checkRequirements(requirements), start = Math.max(1, r.safeStart), available = r.length - r.safeFinish - start;
  if (available < 48) throw new Error('Для четырёх участков нужно минимум 48 клеток между безопасными краями.');
  return Array.from({length: SECTION_COUNT}, (_, index) => {
    const origin = start + Math.floor(available * index / SECTION_COUNT), end = start + Math.floor(available * (index + 1) / SECTION_COUNT);
    const last = index === SECTION_COUNT - 1;
    const targets = {...r, length: last ? r.length : Math.max(24, end), safeFinish: last ? r.safeFinish : 1};
    for (const key of [...Object.keys(COUNTERS), 'minJumps']) targets[key] = Math.floor(r[key] * (index + 1) / SECTION_COUNT);
    return {index, origin, end, width: end - origin, localRightEdge: end - origin - Number(!last), targets};
  });
}
export function sectionSchema(slot) {
  return {type: 'object', additionalProperties: false, required: ['objects'], properties: {
    objects: {type: 'array', minItems: 1, maxItems: 12, items: {type: 'object', additionalProperties: false,
      required: ['type', 'x', 'w', 'h'], properties: {
        type: {type: 'string', enum: ['block', 'spike']}, x: {type: 'integer', minimum: 0, maximum: slot.localRightEdge - 1},
        w: {type: 'integer', minimum: 1, maximum: 3}, h: {type: 'integer', minimum: 1, maximum: 2}}}}}};
}
export function compileSection(raw, prefix, slot, name = 'Sectioned level') {
  const value = parseLevel(raw);
  if (!exact(value, ['objects']) || !Array.isArray(value.objects) || value.objects.length < 1 || value.objects.length > 12) throw new Error('SECTION_SCHEMA: return {objects} with 1..12 objects');
  for (const [index, o] of value.objects.entries()) {
    if (!exact(o, ['type', 'x', 'w', 'h']) || !['block', 'spike'].includes(o.type) || !integer(o.x, 0, slot.localRightEdge - 1)
      || !integer(o.w, 1, 3) || !integer(o.h, 1, 2)) throw new Error(`SECTION_SCHEMA: invalid local object ${index}`);
    if (o.x + o.w > slot.localRightEdge) throw new Error(`SECTION_BOUNDS: local object ${index} ends at ${o.x + o.w}, maximum ${slot.localRightEdge}`);
  }
  return {version: 1, name, length: slot.targets.length,
    objects: [...structuredClone(prefix), ...value.objects.map(o => ({...o, x: slot.origin + o.x}))]};
}
export function evaluateSection(raw, prefix, slot) {
  let level = null, outputError = null, report;
  try {level = compileSection(raw, prefix, slot); report = validate(level, slot.targets);}
  catch (error) {outputError = error.message; report = {schemaValid: false, playable: false, passed: false,
    physics: PHYSICS.id, errors: [{code: 'SECTION_COMPILE', message: outputError}], rules: [], solver: {status: 'invalid', jumpTicks: []}};}
  return {level, report, outputError, accepted: !outputError && report.passed};
}
export function sectionFeedback(candidate, slot) {
  const {report} = candidate;
  return {errors: report.errors, counters: report.stats || null,
    minimumJumps: report.solver.minJumps ?? null, furthestX: report.solver.maxX ?? null,
    localFailureX: report.solver.maxX === undefined ? null : report.solver.maxX - slot.origin,
    instruction: 'Rewrite ONLY this local section. Fix the measured failure and meet every cumulative target. Earlier accepted objects stay fixed. Do not repeat an identical rejected section. Path evidence comes from the whole prefix, not an isolated section.'};
}
export function sectionMessages(item, prefix, slot, condition, previous = []) {
  if (!['none', 'validator'].includes(condition)) throw new Error('Unknown section feedback condition');
  const schema = sectionSchema(slot), r = checkRequirements(item.requirements);
  const messages = [{role: 'system', content: `${SECTION_SYSTEM}\nOutput schema: ${JSON.stringify(schema)}`},
    {role: 'user', content: `Brief: ${item.prompt}\nOriginal final requirements: ${JSON.stringify(r)}\nStage ${slot.index + 1}/4. Local x starts at 0; every local x+w <= ${slot.localRightEdge}. The compiler adds origin ${slot.origin}.\nCumulative targets for the entire prefix at this stage: ${JSON.stringify(slot.targets)}\nAccepted prefix objects (global coordinates, immutable): ${JSON.stringify(prefix)}`}];
  if (previous.length) {
    const last = previous.at(-1);
    messages.push({role: 'user', content: `Your previous local proposals: ${JSON.stringify(previous.map(a => a.raw))}\n${condition === 'validator'
      ? `Exact current whole-prefix validator feedback: ${JSON.stringify(sectionFeedback(last, slot))}`
      : 'No diagnostic report is provided. Produce your own revised local section.'}`});
  }
  return {messages, schema};
}
export async function proposeSection(item, prefix, slot, condition, attempt, previous = [], chat = ollamaChat) {
  const {messages, schema} = sectionMessages(item, prefix, slot, condition, previous);
  const generated = await chat(messages, {seed: item.seed + slot.index * 100 + attempt, schema, temperature: .3});
  return {...generated, ...evaluateSection(generated.raw, prefix, slot), stage: slot.index, attempt,
    diagnostic: condition === 'validator' && previous.length ? sectionFeedback(previous.at(-1), slot) : null};
}
export async function assembleSections(item, condition = 'validator', chat = ollamaChat, randomProposal) {
  if (!SECTION_CONDITIONS.includes(condition)) throw new Error('Unknown assembly condition');
  const r = checkRequirements(item.requirements), slots = sectionPlan(r), stages = []; let prefix = [], completedSections = 0, error = null;
  for (const slot of slots) {
    const stage = {slot, prefix: structuredClone(prefix), attempts: [], accepted: false}; stages.push(stage);
    for (let attempt = 0; attempt < SECTION_ATTEMPTS; attempt++) {
      try {
        const result = condition === 'random' ? randomProposal(item, prefix, slot, attempt)
          : await proposeSection(item, prefix, slot, condition, attempt, stage.attempts, chat);
        stage.attempts.push(result);
        if (result.accepted) {prefix = result.level.objects; stage.accepted = true; completedSections++; break;}
      } catch (e) {error = e.message; break;}
    }
    if (!stage.accepted) break;
  }
  const level = {version: 1, name: 'Sectioned level', length: r.length, objects: prefix}, globalReport = validate(level, r);
  const complete = completedSections === SECTION_COUNT;
  const report = {...globalReport, passed: complete && globalReport.passed,
    rules: [...globalReport.rules, {code: 'ASSEMBLY_COMPLETE', passed: complete, message: `Собрано участков: ${completedSections} / 4`}],
    errors: complete ? globalReport.errors : [...globalReport.errors, {code: 'ASSEMBLY_COMPLETE', message: `Сборка остановлена: ${completedSections} / 4 участков`}], assemblyComplete: complete};
  const attempts = stages.flatMap(s => s.attempts);
  return {mode: 'sectioned', method: SECTION_VERSION, raw: JSON.stringify(level), level, report, globalReport, stages, error,
    assembly: {completedSections, plannedSections: SECTION_COUNT, complete, proposals: attempts.length, condition},
    model: condition === 'random' ? 'random-library-sampler' : process.env.OLLAMA_MODEL || 'qwen3.5:4b',
    tokensIn: attempts.reduce((s, a) => s + (a.tokensIn || 0), 0), tokensOut: attempts.reduce((s, a) => s + (a.tokensOut || 0), 0),
    elapsedMs: attempts.reduce((s, a) => s + (a.elapsedMs || 0), 0)};
}
export async function generateSectioned(params, chat = ollamaChat) {
  if (params.previous !== undefined) throw new Error('Поэтапная сборка запускается с начала; нажмите «Сгенерировать».');
  const condition = params.sectionFeedback ?? 'validator';
  if (!['none', 'validator'].includes(condition)) throw new Error('Неизвестный вариант ОС для сборки.');
  return assembleSections({prompt: params.prompt, requirements: params.requirements, seed: params.seed ?? 42}, condition,
    (messages, options) => chat(messages, {...options, signal: params.signal}));
}
