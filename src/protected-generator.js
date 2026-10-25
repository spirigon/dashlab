import {evaluateRaw, checkRequirements} from '../public/engine.js';
import {generate, ollamaChat} from './llm.js';
import {acceptRepair, generateSafe} from './safe-feedback.js';

export const PROTECTED_VERSION = 'validator-with-acceptance-v1';

// Keep the established full validator feedback. The only intervention is whether
// its literal model proposal replaces the current artifact.
export async function generateProtected(params, chat = ollamaChat) {
  const r = checkRequirements(params.requirements);
  if (params.previous === undefined) return {...await generate({...params, requirements: r, mode: 'validator'}, chat),
    mode: 'safe', feedbackStyle: 'validator', feedbackVersion: PROTECTED_VERSION};
  const before = evaluateRaw(params.previous, r);
  if (before.report.passed) return {...await generateSafe({...params, requirements: r}, chat),
    feedbackStyle: 'validator', feedbackVersion: PROTECTED_VERSION};
  const proposal = await generate({...params, requirements: r, mode: 'validator'}, chat);
  const candidate = {raw: proposal.raw, level: proposal.level, report: proposal.report};
  const acceptance = acceptRepair(before.report, candidate.report);
  const effective = acceptance.accepted ? candidate : {raw: params.previous, ...before};
  return {...proposal, ...effective, candidate, acceptance, mode: 'safe',
    feedbackStyle: 'validator', feedbackVersion: PROTECTED_VERSION};
}
