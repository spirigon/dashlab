import {checkRequirements} from '../public/engine.js';
import {generate, ollamaChat} from './llm.js';
import {evaluateState, proposeEdit, INCREMENTAL_VERSION} from './incremental-repair.js';
import {proposeTargeted, TARGETED_CONDITIONS} from './targeted-feedback.js';

export async function generateIncremental(params, chat = ollamaChat) {
  const requirements = checkRequirements(params.requirements);
  const feedbackStyle = params.feedbackStyle ?? 'actionable';
  if (!TARGETED_CONDITIONS.includes(feedbackStyle)) throw new Error('Неизвестный вариант пошаговой обратной связи.');
  if (params.previous === undefined) return {...await generate({...params, requirements, mode: 'validator'}, chat), mode: 'incremental'};
  const before = evaluateState(params.previous, requirements);
  if (before.report.passed) return {...before, mode: 'incremental', skipped: true, candidate: null,
    model: process.env.OLLAMA_MODEL || 'qwen3.5:4b', tokensIn: 0, tokensOut: 0, elapsedMs: 0,
    acceptance: {accepted: false, reason: 'already-passed', lost: [], gained: []}};
  if (!before.level || before.level.version !== 1 || !Array.isArray(before.level.objects) || before.level.objects.length > 100) {
    throw new Error('Для пошагового исправления нужен JSON наземной карты с массивом objects. Для исправления самого формата выберите полный отчёт валидатора.');
  }
  const history = params.editHistory || [];
  if (!Array.isArray(history) || history.length > 4 || history.some(h => !h || typeof h !== 'object' || !h.decision || !Array.isArray(h.candidate?.report?.errors))) throw new Error('Некорректная история пошаговых правок.');
  const item = {prompt: params.prompt, requirements, editSeed: params.seed ?? 42};
  const result = await (feedbackStyle === 'targeted' ? proposeTargeted : proposeEdit)(item, before, feedbackStyle, 0, history, (messages, options) => {
    const input = params.playtest ? [...messages, {role: 'user', content: `Human-reported actual-game feedback (not independently verified): ${JSON.stringify(params.playtest)}`}] : messages;
    return chat(input, {...options, signal: params.signal});
  });
  const editStep = {edit: result.edit, decision: result.decision, candidate: {report: {errors: result.candidate.report.errors}}};
  return {...result, ...result.effective, rawEdit: result.raw, mode: 'incremental',
    acceptance: result.decision, editStep, feedbackVersion: result.feedbackVersion || INCREMENTAL_VERSION,
    hasHumanFeedback: Boolean(params.playtest)};
}
