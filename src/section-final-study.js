import {sectionPlan} from './sectioned-generator.js';
import {planWitness, randomPlanSection} from './section-plan-study.js';
import {summarizeSections} from './sectioned-study.js';
import {evaluateFinalSection, FINAL_SECTION_VERSION} from './section-plan-final.js';
export function finalCases(tasks) {
  return tasks.flatMap((task, index) => [0, 1].map(replica => ({...task, task: task.id, id: `${task.id}-${replica}`,
    replica, seed: 181000 + 1000 * (index * 2 + replica)})));
}
export function finalWitness(task) {
  const source = planWitness(task), stages = []; let prefix = [];
  for (const slot of sectionPlan(task.requirements)) {
    const raw = source.stages[slot.index].raw, result = evaluateFinalSection(raw, prefix, slot, task.requirements);
    if (!result.accepted) throw new Error('Hidden final-stage witness failed');
    stages.push({slot, raw, report: result.report}); prefix = result.level.objects;
  }
  return {task: task.id, hiddenFromModel: true, source: 'feasibility-only-NOT-LLM', stages,
    level: {version: 1, name: 'Hidden witness', length: task.requirements.length, objects: prefix}};
}
export function randomFinalSection(item, prefix, slot, attempt) {
  const base = randomPlanSection({...item, seed: item.seed + 3000000}, prefix, slot, attempt);
  return {...base, ...evaluateFinalSection(base.raw, prefix, slot, item.requirements)};
}
export function summarizeFinal(rows, cases) {
  return {...summarizeSections(rows, cases), studyVersion: FINAL_SECTION_VERSION,
    limitations: 'Third and final deadline revision, informed by two earlier pilots; six reused tasks, two new seeds each. Same plan space/compiler and 12-candidate maximum across arms. Intermediate numerical quotas now guide planning; only structure/path are mandatory until the final full original requirements. Temperature .65 for both LLM arms. Different revisions cannot isolate the gate effect because seeds, wording and temperature also changed. Common filter and residual arithmetic remain domain knowledge, none is absence of rejected-plan diagnostic only. No native-game playthrough evidence.'};
}
