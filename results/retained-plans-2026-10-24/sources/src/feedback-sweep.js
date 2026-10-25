import {checkRequirements, validate, parseLevel, PHYSICS, diversity} from '../public/engine.js';
import {sectionPlan} from './sectioned-generator.js';
import {PAIRS, EXTRAS, planSectionSchema, evaluateSectionPlan} from './section-plan-generator.js';
import {evaluateFinalSection, finalSectionMessages} from './section-plan-final.js';
import {randomFinalSection} from './section-final-study.js';

export const SWEEP_VERSION = 'section-feedback-sweep-v1';
export const METHODS = ['staged', 'global'];
export const CONDITIONS = ['none', 'exact', 'compact', 'actionable', 'random'];
export const COUNTERS = {minSpikes: 'spikes', minBlocks: 'blocks', minDoubleSpikes: 'doubleSpikes',
  minTripleSpikes: 'tripleSpikes', minTallBlocks: 'tallBlocks', minTightGaps: 'tightGaps'};
export function sweepCases(tasks) {
  return tasks.flatMap((task, t) => Array.from({length: 6}, (_, replica) => ({...task, task: task.id,
    id: `${task.id}-sweep-${replica}`, replica, seed: 301000 + 1000 * (t * 6 + replica)})));
}
export function compactFeedback(candidate, r, slots) {
  const report = candidate.report, x = report.solver.maxX ?? null;
  const deficits = report.stats ? Object.entries(COUNTERS).filter(([key, stat]) => r[key] > report.stats[stat])
    .map(([key, stat]) => ({counter: stat, actual: report.stats[stat], required: r[key], missing: r[key] - report.stats[stat]})) : [];
  return {errors: report.errors.map(e => e.code), deficits,
    jumps: {actual: report.solver.minJumps ?? null, required: r.minJumps},
    failure: report.playable ? null : {x, section: x === null ? null : (slots.find(s => x < s.end)?.index ?? 3) + 1},
    ...(candidate.outputError ? {schemaError: candidate.outputError} : {})};
}
// Static explanations of library edits, never a tested replacement or an oracle.
export function actionHints(feedback) {
  const missing = new Set(feedback.deficits.map(d => d.counter)), hints = [];
  if (missing.has('spikes') || missing.has('doubleSpikes') || missing.has('tripleSpikes'))
    hints.push('Need more spike groups: stairs -> tower_triple adds 3 spikes, 1 double and 1 triple, loses 1 block; stairs -> triple_pair adds 6 spikes, 2 doubles and 2 triples, loses 2 blocks and 1 tall block.');
  if (missing.has('blocks')) hints.push('Need more blocks: triple_pair -> tower_triple adds 1 block and 1 tall block, loses 3 spikes and 1 double/triple; triple_pair -> stairs adds 2 blocks and 1 tall block, loses 6 spikes and 2 double/triple groups.');
  if (missing.has('tallBlocks')) hints.push('Need more tall blocks: replace triple_pair by tower_triple or stairs, or change an available extra to tall_block. Check the lost spike counts.');
  if (feedback.errors.includes('NO_PATH')) hints.push(`Path dies near section ${feedback.failure?.section ?? '?'} at x=${feedback.failure?.x ?? '?'}. Change the FIRST pair or pair order there; a tall extra near the next section can also change the landing. Count-only changes do not prove a path.`);
  if (feedback.errors.includes('MIN_JUMPS')) hints.push('A route skips an intended jump. Change pair types or extra at a section join; actual search, not pair count, decides minimum jumps.');
  if (missing.has('tightGaps')) hints.push('Each library pair contains one tight gap. Pair counts are fixed; changing an extra cannot create another internal pair.');
  hints.push('Preserve counters that already pass. Balance mixed deficits with tower_triple rather than switching every pair to a single type. Do not repeat a rejected plan. These are untested edit options, not guaranteed fixes.');
  return hints;
}
function feedbackText(condition, candidate, requirements, slots) {
  if (condition === 'none') return 'No rejected-candidate diagnostic is supplied. Return your own revised choices.';
  if (condition === 'exact') return `Exact validator execution report: ${JSON.stringify({errors: candidate.report.errors,
    counters: candidate.report.stats ?? null, minJumps: candidate.report.solver.minJumps ?? null, furthestX: candidate.report.solver.maxX ?? null})}`;
  const feedback = compactFeedback(candidate, requirements, slots);
  return `Short measured execution feedback: ${JSON.stringify(feedback)}${condition === 'actionable' ? `\nStatic edit options (not tested plans): ${JSON.stringify(actionHints(feedback))}` : ''}`;
}
export function stagedSweepMessages(item, prefix, slot, condition, previous) {
  // Reproduce the deployed prompts exactly for the two original treatments.
  if (condition === 'none' || condition === 'exact') return finalSectionMessages(item, prefix, slot, condition === 'exact' ? 'validator' : 'none', previous);
  const base = finalSectionMessages(item, prefix, slot, 'none', []);
  if (previous.length) {
    const last = previous.at(-1), requirements = last.validationRequirements ?? slot.targets;
    base.messages.push({role: 'user', content: `Previous local plans: ${JSON.stringify(previous.map(a => a.raw))}\n${feedbackText(condition, last, requirements, sectionPlan(item.requirements))}`});
  }
  return base;
}
export function globalSchema(r) {
  const slots = sectionPlan(r), keys = slots.map(s => 's' + (s.index + 1));
  return {type: 'object', additionalProperties: false, required: keys,
    properties: Object.fromEntries(slots.map(s => ['s' + (s.index + 1), planSectionSchema(s, r)]))};
}
export function evaluateGlobal(raw, requirements) {
  const r = checkRequirements(requirements), slots = sectionPlan(r); let plan = null, prefix = [];
  try {
    plan = parseLevel(raw);
    if (!plan || Array.isArray(plan) || Object.keys(plan).length !== 4 || slots.some(s => !Object.hasOwn(plan, 's' + (s.index + 1)))) throw new Error('PLAN_SCHEMA: exactly s1,s2,s3,s4 required');
    for (const slot of slots) {
      const part = evaluateSectionPlan(JSON.stringify(plan['s' + (slot.index + 1)]), prefix, slot, r);
      if (!part.level) throw new Error(part.outputError || 'Section compile failed');
      prefix = part.level.objects;
    }
    const level = {version: 1, name: 'Global library plan', length: r.length, objects: prefix}, report = validate(level, r);
    return {plan, level, report, outputError: null, accepted: report.passed};
  } catch (e) {
    return {plan, level: null, outputError: e.message, accepted: false,
      report: {schemaValid: false, playable: false, passed: false, physics: PHYSICS.id, rules: [], errors: [{code: 'PLAN_SCHEMA', message: e.message}], solver: {status: 'invalid', jumpTicks: []}}};
  }
}
export function globalMessages(item, condition, previous = []) {
  const r = checkRequirements(item.requirements), slots = sectionPlan(r), schema = globalSchema(r);
  const base = finalSectionMessages(item, [], slots[0], 'none', []);
  const messages = [{role: 'system', content: base.messages[0].content.split('\nOutput schema:')[0]
    .replace('one of four sections at a time', 'all four sections in one response')
    .replace('Return ONLY {pairs:[...],extra:...} matching the schema.', 'Return ONLY {s1:{pairs:[...],extra:...},s2:...,s3:...,s4:...} matching the schema.')
    .replace('Never change accepted previous objects or original final requirements.', 'All four sections may be revised. Never change the original requirements.')
    + `\nThis is JOINT planning: there is NO accepted immutable prefix. Every response is a complete four-section plan. The validator checks all original requirements and the FULL path; a failed map is never exported as success. During revision you may change ANY section. Plan counts across the WHOLE level; never repeat whole-level counts in every section. Output schema: ${JSON.stringify(schema)}`},
  {role: 'user', content: `Brief: ${item.prompt}\nOriginal final requirements: ${JSON.stringify(r)}\nFixed section slots: ${JSON.stringify(slots.map(s => ({section: s.index + 1, origin: s.origin, localRightEdge: s.localRightEdge, pairs: schema.properties['s' + (s.index + 1)].properties.pairs.minItems, extraChoices: schema.properties['s' + (s.index + 1)].properties.extra.enum})))}\nThe exact compiler and library are unchanged. You choose all types and orders. Only actual search proves the minimum jumps and path.`}];
  if (previous.length) messages.push({role: 'user', content: `Previous rejected complete plans: ${JSON.stringify(previous.map(a => a.raw))}\n${feedbackText(condition, previous.at(-1), r, slots)}\nReturn the complete replacement plan with all four sections.`});
  return {messages, schema};
}
function randomGlobal(item, attempt) {
  const plan = {};
  for (const slot of sectionPlan(item.requirements)) {
    // Same uniform plan distribution as staged random, with attempt independent of filters.
    const part = randomFinalSection(item, [], slot, attempt);
    plan['s' + (slot.index + 1)] = JSON.parse(part.raw);
  }
  const raw = JSON.stringify(plan);
  return {raw, ...evaluateGlobal(raw, item.requirements), source: 'uniform-same-library-plan-space-NOT-LLM', tokensIn: 0, tokensOut: 0, elapsedMs: 0};
}
export async function runSweepChain(item, method, condition, chat) {
  if (!METHODS.includes(method) || !CONDITIONS.includes(condition)) throw new Error('Unknown sweep treatment');
  const r = checkRequirements(item.requirements), stages = [], attempts = []; let error = null, prefix = [], completedSections = 0;
  if (method === 'staged') {
    for (const slot of sectionPlan(r)) {
      const stage = {slot, prefix: structuredClone(prefix), attempts: [], accepted: false}; stages.push(stage);
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          let result;
          if (condition === 'random') result = randomFinalSection(item, prefix, slot, attempt);
          else {
            const {messages, schema} = stagedSweepMessages(item, prefix, slot, condition, stage.attempts);
            const response = await chat(messages, {seed: item.seed + slot.index * 100 + attempt, schema, temperature: .65}, {stage: slot.index, attempt});
            result = {...response, ...evaluateFinalSection(response.raw, prefix, slot, r), stage: slot.index, attempt};
          }
          stage.attempts.push(result); attempts.push(result);
          if (result.accepted) {prefix = result.level.objects; stage.accepted = true; completedSections++; break;}
        } catch (e) {error = e.message; break;}
      }
      if (!stage.accepted) break;
    }
    const level = {version: 1, name: 'Feedback sweep staged', length: r.length, objects: prefix}, globalReport = validate(level, r);
    return {method, condition, level, globalReport, passed: !error && completedSections === 4 && globalReport.passed,
      completedSections, complete: completedSections === 4, stages, attempts, error};
  }
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      let result;
      if (condition === 'random') result = randomGlobal(item, attempt);
      else {
        const {messages, schema} = globalMessages(item, condition, attempts);
        const response = await chat(messages, {seed: item.seed + attempt, schema, temperature: .65}, {stage: null, attempt});
        result = {...response, ...evaluateGlobal(response.raw, r), attempt};
      }
      attempts.push(result); if (result.accepted) break;
    } catch (e) {error = e.message; break;}
  }
  const last = attempts.at(-1);
  return {method, condition, level: last?.level ?? null, globalReport: last?.report ?? null, passed: !error && Boolean(last?.accepted),
    complete: Boolean(last?.level), completedSections: last?.level ? 4 : 0, stages, attempts, error};
}
function clusterP(diffs) {
  const observed = diffs.reduce((s, x) => s + x, 0); let extreme = 0;
  for (let mask = 0; mask < 2 ** diffs.length; mask++) {
    const perm = diffs.reduce((s, x, i) => s + (mask & 2 ** i ? x : -x), 0);
    if (Math.abs(perm) >= Math.abs(observed)) extreme++;
  }
  return extreme / 2 ** diffs.length;
}
export function summarizeSweep(rows, cases) {
  const summary = METHODS.flatMap(method => CONDITIONS.map(condition => {
    const group = rows.filter(r => r.method === method && r.condition === condition), attempts = group.flatMap(r => r.result.attempts);
    const successes = group.filter(r => r.result.passed), first = group.filter(r => method === 'global' && r.result.attempts[0]?.accepted);
    const repeatCount = group.reduce((total, row) => {
      const batches = method === 'global' ? [row.result.attempts] : row.result.stages.map(s => s.attempts);
      return total + batches.reduce((n, batch) => {
        const seen = new Set(); return n + batch.reduce((m, a) => {
          let key; try {key = JSON.stringify(JSON.parse(a.raw));} catch {key = a.raw;}
          const repeated = seen.has(key); seen.add(key); return m + Number(repeated);
        }, 0);
      }, 0);
    }, 0);
    return {method, condition, planned: cases.length, completed: group.length, successes: successes.length,
      firstDraftSuccess: method === 'global' ? first.length : null, proposals: attempts.length,
      repeats: repeatCount, invalid: attempts.filter(a => a.outputError).length, infrastructureErrors: group.filter(r => r.result.error).length,
      uniqueSuccessfulGeometries: new Set(successes.map(r => JSON.stringify(r.result.level.objects))).size,
      diversitySuccessful: diversity(successes.map(r => r.result.level)),
      logicalTokensIn: attempts.reduce((s, a) => s + (a.tokensIn || 0), 0), logicalTokensOut: attempts.reduce((s, a) => s + (a.tokensOut || 0), 0),
      logicalResponseMs: attempts.reduce((s, a) => s + (a.elapsedMs || 0), 0)};
  }));
  const comparisons = METHODS.flatMap(method => [['actionable', 'none', true], ['exact', 'none', false], ['compact', 'none', false], ['actionable', 'exact', false], ['actionable', 'random', false]].map(([a, b, primary]) => {
    let both = 0, aOnly = 0, bOnly = 0, neither = 0, matched = 0;
    const clusters = [...new Set(cases.map(c => c.task))].map(task => {
      let difference = 0;
      for (const c of cases.filter(c => c.task === task)) {
        const ar = rows.find(row => row.caseId === c.id && row.method === method && row.condition === a);
        const br = rows.find(row => row.caseId === c.id && row.method === method && row.condition === b);
        if (!ar || !br) continue; matched++;
        const ap = ar.result.passed, bp = br.result.passed; difference += Number(ap) - Number(bp);
        if (ap && bp) both++; else if (ap) aOnly++; else if (bp) bOnly++; else neither++;
      }
      return {task, difference};
    });
    return {method, a, b, primary, matched, both, aOnly, bOnly, neither, clusters,
      clusterP: matched === cases.length ? clusterP(clusters.map(c => c.difference)) : null};
  }));
  const primary = comparisons.filter(c => c.primary && c.clusterP !== null).sort((a, b) => a.clusterP - b.clusterP);
  primary.forEach((c, i) => {c.holmP = Math.min(1, Math.max(...primary.slice(0, i + 1).map((p, k) => p.clusterP * (primary.length - k))));});
  return {studyVersion: SWEEP_VERSION, completed: rows.length, planned: cases.length * METHODS.length * CONDITIONS.length,
    summary, comparisons, endpoint: 'Complete literal four-section map AND every unchanged original constraint AND whole-level proxy path.',
    limitations: 'Exploratory development sweep on six reused task configurations, six new seeds each; not new task families. Two predeclared primary contrasts with Holm adjustment across methods; secondary contrasts descriptive. Fixed library/compiler, shared initial response per method/case, same filter and budget within each method. Methods have different call/output costs and are not a pure feedback comparison. none receives binary rejection and previous plans. Suggestions are static code-derived edits, not an extra LLM critic or tested replacement. No native-game playthrough evidence.'};
}
