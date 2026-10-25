import {MOTIFS} from './motif-generator.js';
import {sectionPlan, evaluateSection, SECTION_VERSION, SECTION_CONDITIONS} from './sectioned-generator.js';
import {exactPaired} from './repair-study.js';
import {diversity} from '../public/engine.js';

const SINGLE = [{type: 'spike', w: 1, h: 1}, {type: 'spike', w: 2, h: 1}, {type: 'spike', w: 3, h: 1},
  {type: 'block', w: 1, h: 1}, {type: 'block', w: 1, h: 2}];
function proposalShape(slot, r) {
  const previous = Math.floor(r.minJumps * slot.index / 4), jumps = slot.targets.minJumps - previous;
  return {pairs: Math.floor(jumps / 2), single: jumps % 2 === 1 || jumps === 0};
}
export function librarySection(types, single = null) {
  let x = 0; const objects = [];
  for (const type of types) {
    objects.push(...MOTIFS[type].map(o => ({...o, x: x + o.x})));
    x += Math.max(...MOTIFS[type].map(o => o.x + o.w)) + 5;
  }
  if (single) objects.push({...single, x});
  return JSON.stringify({objects});
}
export function randomSection(item, prefix, slot, attempt) {
  let seed = (item.seed + 7000000 + slot.index * 100 + attempt) >>> 0;
  const rand = () => {seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296;};
  const shape = proposalShape(slot, item.requirements), keys = Object.keys(MOTIFS);
  const types = Array.from({length: shape.pairs}, () => keys[Math.floor(rand() * keys.length)]);
  const raw = librarySection(types, shape.single ? SINGLE[Math.floor(rand() * SINGLE.length)] : null);
  return {raw, ...evaluateSection(raw, prefix, slot), stage: slot.index, attempt,
    source: 'uniform-library-section-NOT-LLM', types, tokensIn: 0, tokensOut: 0, elapsedMs: 0, diagnostic: null};
}
function combinations(keys, count) {
  if (!count) return [[]];
  return combinations(keys, count - 1).flatMap(prefix => keys.map(k => [...prefix, k]));
}
export function sectionWitness(task) {
  const slots = sectionPlan(task.requirements), stages = []; let prefix = [];
  for (const slot of slots) {
    const shape = proposalShape(slot, task.requirements); let found = null;
    for (const types of combinations(Object.keys(MOTIFS), shape.pairs)) {
      for (const single of shape.single ? SINGLE : [null]) {
        const raw = librarySection(types, single), result = evaluateSection(raw, prefix, slot);
        if (result.accepted) {found = {raw, ...result}; break;}
      }
      if (found) break;
    }
    if (!found) throw new Error(`No hidden section feasibility witness for ${task.id}, stage ${slot.index + 1}`);
    stages.push({slot, raw: found.raw, report: found.report}); prefix = found.level.objects;
  }
  return {task: task.id, hiddenFromModel: true, source: 'exhaustive-library-feasibility-check-NOT-LLM',
    stages, level: {version: 1, name: 'Hidden witness', length: task.requirements.length, objects: prefix}};
}
export function sectionCases(tasks) {
  return tasks.flatMap((task, index) => [0, 1].map(replica => ({...task, task: task.id, id: `${task.id}-${replica}`,
    replica, seed: 81000 + 1000 * (index * 2 + replica)})));
}
function clusterTest(differences) {
  let extreme = 0; const observed = differences.reduce((s, d) => s + d, 0);
  for (let mask = 0; mask < 2 ** differences.length; mask++) {
    const value = differences.reduce((s, d, i) => s + (mask & 2 ** i ? d : -d), 0);
    if (Math.abs(value) >= Math.abs(observed)) extreme++;
  }
  return {differences, observed, twoSidedP: extreme / 2 ** differences.length,
    assumption: 'Exchangeable condition labels within six fixed task clusters; deterministic alternating order, exploratory development pilot, not population randomization.'};
}
export function summarizeSections(rows, cases) {
  const summary = SECTION_CONDITIONS.map(condition => {
    const group = rows.filter(r => r.condition === condition), attempts = group.flatMap(r => r.result?.stages.flatMap(s => s.attempts) || []);
    const success = group.filter(r => !r.error && r.result?.report.passed);
    const hashes = new Set(success.map(r => JSON.stringify({length: r.result.level.length, objects: [...r.result.level.objects].sort((a, b) => a.x - b.x)})));
    return {condition, planned: cases.length, completed: group.length, successes: success.length,
      completeAssemblies: group.filter(r => r.result?.assembly.complete).length,
      proxyPlayable: group.filter(r => r.result?.globalReport.playable).length,
      completedSections: group.reduce((s, r) => s + (r.result?.assembly.completedSections || 0), 0),
      proposals: attempts.length, rejected: attempts.filter(a => !a.accepted).length,
      invalidSections: attempts.filter(a => a.outputError).length, infrastructureErrors: group.filter(r => r.error || r.result?.error).length,
      uniqueSuccessfulGeometries: hashes.size, diversitySuccessful: diversity(success.map(r => r.result.level)),
      logicalTokensIn: attempts.reduce((s, a) => s + (a.tokensIn || 0), 0), logicalTokensOut: attempts.reduce((s, a) => s + (a.tokensOut || 0), 0),
      logicalResponseMs: attempts.reduce((s, a) => s + (a.elapsedMs || 0), 0)};
  });
  const comparisons = [['validator', 'none', true], ['validator', 'random', false]].map(([a, b, primary]) => {
    let both = 0, aOnly = 0, bOnly = 0, neither = 0, matched = 0;
    const clusters = [...new Set(cases.map(c => c.task))].map(task => {
      let difference = 0;
      for (const c of cases.filter(c => c.task === task)) {
        const ar = rows.find(r => r.caseId === c.id && r.condition === a), br = rows.find(r => r.caseId === c.id && r.condition === b);
        if (!ar || !br) continue; matched++;
        const ap = !ar.error && ar.result?.report.passed, bp = !br.error && br.result?.report.passed;
        difference += Number(Boolean(ap)) - Number(Boolean(bp));
        if (ap && bp) both++; else if (ap) aOnly++; else if (bp) bOnly++; else neither++;
      }
      return {task, difference};
    });
    return {a, b, primary, matched, both, aOnly, bOnly, neither, clusters,
      descriptiveExactP: matched === cases.length ? exactPaired(aOnly, bOnly) : null,
      conditionalClusterTest: matched === cases.length ? clusterTest(clusters.map(c => c.difference)) : null};
  });
  return {studyVersion: SECTION_VERSION, completed: rows.length, planned: cases.length * 3,
    caseCount: cases.length, sections: 4, attemptsPerSection: 3, maximumProposalsPerMap: 12, summary, comparisons,
    endpoint: 'Four sections assembled from empty prefix, final original requirements AND path in the unchanged whole-level proxy. No failed-stage fallback.',
    limitations: 'Six reused nearby task configurations, two new seeds each; fixed partition, cumulative quota planner, width/height schema limits and shared motif hints embed domain knowledge. Both LLM arms use the SAME acceptance filter; none lacks diagnostic reports but can infer rejection from retries. Random library sampler is a different, restricted proposal distribution with the same hints/filter/budget. No native-game validation or direct percentage comparison to older whole-level studies.'};
}
