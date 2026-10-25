import {LEVEL_SCHEMA, checkRequirements, evaluateRaw} from '../public/engine.js';
import {generate, generatorMessages, ollamaChat} from './llm.js';
import {localizedFeedback} from './local-feedback.js';

export const SAFE_FEEDBACK_VERSION = 'focused-feedback-with-acceptance-v1';

// Unknown / unmeasured checks never count as passed. The guard preserves evidence,
// not unmeasured properties such as native-game difficulty or visual quality.
export function passedChecks(report) {
  return new Set([
    ...(report.schemaValid === true ? ['SCHEMA'] : []),
    ...(report.playable === true ? ['PATH'] : []),
    ...report.rules.filter(rule => rule.passed === true).map(rule => rule.code),
  ]);
}

export function acceptRepair(before, after) {
  const old = passedChecks(before), next = passedChecks(after);
  const lost = [...old].filter(code => !next.has(code));
  const gained = [...next].filter(code => !old.has(code));
  const reason = before.passed ? 'already-passed' : lost.length ? 'regression'
    : !gained.length ? 'no-progress' : 'improvement';
  return {accepted: reason === 'improvement', reason, lost, gained,
    beforePassed: old.size, afterPassed: next.size};
}

export function focusedFeedback(raw, requirements) {
  const {report} = evaluateRaw(raw, requirements);
  if (report.passed) return null;
  const detail = localizedFeedback(raw, requirements);
  const target = detail.priority[0] || report.errors[0] || {code: 'SEARCH_BUDGET', message: 'Search was inconclusive.'};
  const evidence = {physics: report.physics, target};
  if (target.code === 'NO_PATH') {
    evidence.blockingObjects = detail.execution?.blockingObjects || [];
    evidence.nearbyObjects = detail.localObjects || [];
    evidence.note = 'All proxy trajectories stop here. Change this neighbourhood, then recheck the whole level.';
  }
  const deficit = detail.deficits?.find(d => ({MIN_JUMPS: 'minJumps', SPIKES: 'minSpikes', BLOCKS: 'minBlocks',
    DOUBLE_SPIKES: 'minDoubleSpikes', TRIPLE_SPIKES: 'minTripleSpikes', TALL_BLOCKS: 'minTallBlocks', TIGHT_GAPS: 'minTightGaps'})[target.code] === d.requirement);
  if (deficit) evidence.deficit = deficit;
  return {...evidence, preservePassedChecks: [...passedChecks(report)],
    instruction: 'Fix this priority issue using the smallest necessary changes. Keep all other objects unchanged where possible. Preserve every passed check and all original requirements. Return a complete JSON level, not an edit script. These are approximate proxy measurements.'};
}

export function focusedMessages(item) {
  const diagnostic = focusedFeedback(item.raw, item.requirements);
  if (!diagnostic) return {messages: null, diagnostic: null};
  return {messages: generatorMessages(item.prompt, item.requirements, item.raw,
    `One priority to repair (measured by the proxy):\n${JSON.stringify(diagnostic)}\n`), diagnostic};
}

// Inference produces an unmodified proposal; acceptance chooses between two
// complete artifacts. No procedural repair or extra model call is hidden here.
export async function generateSafe({prompt, requirements, seed = 42, previous, signal, playtest}, chat = ollamaChat) {
  const r = checkRequirements(requirements);
  if (previous === undefined) return {...await generate({prompt, requirements: r, seed, signal}, chat), mode: 'safe'};
  const before = evaluateRaw(previous, r);
  if (before.report.passed) return {raw: previous, ...before, mode: 'safe', model: process.env.OLLAMA_MODEL || 'qwen3.5:4b',
    tokensIn: 0, tokensOut: 0, elapsedMs: 0, skipped: true,
    acceptance: acceptRepair(before.report, before.report), candidate: null, feedbackVersion: SAFE_FEEDBACK_VERSION};
  const {messages, diagnostic} = focusedMessages({prompt, requirements: r, raw: previous});
  if (playtest) messages.at(-1).content += `\nHuman-reported game feedback (not independently verified): ${JSON.stringify(playtest)}`;
  const generated = await chat(messages, {seed, schema: LEVEL_SCHEMA, temperature: .65, signal});
  const candidate = {...evaluateRaw(generated.raw, r), raw: generated.raw};
  const acceptance = acceptRepair(before.report, candidate.report);
  const effective = acceptance.accepted ? candidate : {raw: previous, ...before};
  return {...generated, ...effective, candidate, acceptance, diagnostic, mode: 'safe',
    hasHumanFeedback: Boolean(playtest), feedbackVersion: SAFE_FEEDBACK_VERSION};
}
