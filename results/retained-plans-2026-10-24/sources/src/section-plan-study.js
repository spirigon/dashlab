import {sectionPlan} from './sectioned-generator.js';
import {summarizeSections} from './sectioned-study.js';
import {PAIRS, EXTRAS, planShape, evaluateSectionPlan, SECTION_PLAN_VERSION} from './section-plan-generator.js';

export function planCases(tasks) {
  return tasks.flatMap((task, index) => [0, 1].map(replica => ({...task, task: task.id, id: `${task.id}-${replica}`,
    replica, seed: 121000 + 1000 * (index * 2 + replica)})));
}
function combinations(count) {return count ? combinations(count - 1).flatMap(p => PAIRS.map(k => [...p, k])) : [[]];}
export function planWitness(task) {
  let prefix = []; const stages = [];
  for (const slot of sectionPlan(task.requirements)) {
    const shape = planShape(slot, task.requirements); let found = null;
    for (const pairs of combinations(shape.pairs)) {
      for (const extra of shape.extra ? Object.keys(EXTRAS) : ['none']) {
        const raw = JSON.stringify({pairs, extra}), result = evaluateSectionPlan(raw, prefix, slot, task.requirements);
        if (result.accepted) {found = {raw, ...result}; break;}
      }
      if (found) break;
    }
    if (!found) throw new Error(`No hidden plan witness: ${task.id}, stage ${slot.index}`);
    stages.push({slot, raw: found.raw, report: found.report}); prefix = found.level.objects;
  }
  return {task: task.id, hiddenFromModel: true, source: 'exhaustive-plan-feasibility-NOT-LLM', stages,
    level: {version: 1, name: 'Hidden plan witness', length: task.requirements.length, objects: prefix}};
}
export function randomPlanSection(item, prefix, slot, attempt) {
  let seed = (item.seed + 9000000 + slot.index * 100 + attempt) >>> 0;
  const rand = () => {seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296;};
  const shape = planShape(slot, item.requirements), extras = Object.keys(EXTRAS);
  const plan = {pairs: Array.from({length: shape.pairs}, () => PAIRS[Math.floor(rand() * PAIRS.length)]),
    extra: shape.extra ? extras[Math.floor(rand() * extras.length)] : 'none'};
  const raw = JSON.stringify(plan);
  return {raw, ...evaluateSectionPlan(raw, prefix, slot, item.requirements), stage: slot.index, attempt,
    source: 'uniform-same-plan-space-NOT-LLM', tokensIn: 0, tokensOut: 0, elapsedMs: 0, diagnostic: null};
}
export function summarizePlans(rows, cases) {
  return {...summarizeSections(rows, cases), studyVersion: SECTION_PLAN_VERSION,
    limitations: 'Second exploratory revision after coordinate-section failure. Six reused tasks, two NEW seeds each. Fixed library geometry, 5-tile spacing, four intervals, pair/extra counts and arithmetic residual-quota planner embed substantial domain knowledge. All three arms use the SAME plan space, compiler, acceptance and candidate cap. none lacks rejected-candidate diagnostics but shares planning state and can infer rejection. No native-game validation; do not pool revisions or claim the compiler effect is a pure feedback gain.'};
}
