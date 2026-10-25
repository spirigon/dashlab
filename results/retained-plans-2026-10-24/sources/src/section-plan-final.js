import {validate, checkRequirements} from '../public/engine.js';
import {sectionPlan} from './sectioned-generator.js';
import {sectionPlanMessages, evaluateSectionPlan} from './section-plan-generator.js';
import {ollamaChat} from './llm.js';
export const FINAL_SECTION_VERSION = 'section-plans-final-requirements-v1';

export function evaluateFinalSection(raw, prefix, slot, requirements) {
  const result = evaluateSectionPlan(raw, prefix, slot, requirements);
  if (!result.level || slot.index === 3) return result;
  // Partial quotas are planning guidance. A feasible partial map must not be
  // rejected for a count that later sections can still supply.
  const validationRequirements = {...slot.targets, minSpikes: 0, minBlocks: 0, minDoubleSpikes: 0,
    minTripleSpikes: 0, minTallBlocks: 0, minTightGaps: 0, minJumps: 0};
  const report = validate(result.level, validationRequirements);
  return {...result, planningReport: result.report, validationRequirements, report, accepted: report.passed};
}
export function finalSectionMessages(item, prefix, slot, condition, previous = []) {
  const base = sectionPlanMessages(item, prefix, slot, condition, []);
  base.messages[1].content += '\nIntermediate geometric count quotas and cumulative jump targets are PLANNING GUIDANCE, not acceptance requirements at stages 1..3. Structure and whole-prefix playability are mandatory at every stage. ALL original counts and minimum jumps become mandatory at stage 4. Balance the final requirements across sections.';
  if (previous.length) {
    const last = previous.at(-1), feedback = {errors: last.report.errors, counters: last.report.stats || null,
      minJumps: last.report.solver.minJumps ?? null, furthestX: last.report.solver.maxX ?? null,
      instruction: 'Change the plan, not the coordinates. For a join failure near the new origin, try a different FIRST pair or order; it changes the approach and landing. At stage four satisfy the remaining original counters as well. No corrected plan has been tested or supplied.'};
    base.messages.push({role: 'user', content: `Previous local plans: ${JSON.stringify(previous.map(a => a.raw))}\n${condition === 'validator'
      ? `Exact rejected-plan execution feedback: ${JSON.stringify(feedback)}` : 'No rejected-plan diagnostic is provided. Return your own revised choices.'}`});
  }
  return base;
}
export async function assembleFinalSections(item, condition = 'validator', chat = ollamaChat, randomProposal) {
  if (!['none', 'validator', 'random'].includes(condition)) throw new Error('Unknown final-section condition');
  const r = checkRequirements(item.requirements), stages = []; let prefix = [], completedSections = 0, error = null;
  for (const slot of sectionPlan(r)) {
    const stage = {slot, prefix: structuredClone(prefix), attempts: [], accepted: false}; stages.push(stage);
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        let result;
        if (condition === 'random') result = randomProposal(item, prefix, slot, attempt);
        else {
          const {messages, schema} = finalSectionMessages(item, prefix, slot, condition, stage.attempts);
          const generated = await chat(messages, {seed: item.seed + slot.index * 100 + attempt, schema, temperature: .65});
          result = {...generated, ...evaluateFinalSection(generated.raw, prefix, slot, r), stage: slot.index, attempt};
        }
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
  return {mode: 'sectioned', method: FINAL_SECTION_VERSION, raw: JSON.stringify(level), level, report, globalReport, stages, error,
    assembly: {completedSections, plannedSections: 4, complete, proposals: attempts.length, condition, representation: 'library-plans-final-check'},
    model: condition === 'random' ? 'random-library-sampler' : process.env.OLLAMA_MODEL || 'qwen3.5:4b',
    tokensIn: attempts.reduce((s, a) => s + (a.tokensIn || 0), 0), tokensOut: attempts.reduce((s, a) => s + (a.tokensOut || 0), 0), elapsedMs: attempts.reduce((s, a) => s + (a.elapsedMs || 0), 0)};
}
export async function generateFinalSections(params, chat = ollamaChat) {
  if (params.previous !== undefined) throw new Error('Поэтапная сборка запускается с начала; нажмите «Сгенерировать».');
  const condition = params.sectionFeedback ?? 'validator';
  if (!['none', 'validator'].includes(condition)) throw new Error('Неизвестный вариант ОС для сборки.');
  return assembleFinalSections({prompt: params.prompt, requirements: params.requirements, seed: params.seed ?? 42}, condition,
    (messages, options) => chat(messages, {...options, signal: params.signal}));
}
