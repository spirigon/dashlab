import {checkRequirements} from '../public/engine.js';
import {editMessages, evaluateEdit} from './incremental-repair.js';
import {ollamaChat} from './llm.js';

export const TARGETED_VERSION = 'concise-targets-v1';
export const TARGETED_CONDITIONS = ['actionable', 'targeted'];

const countRules = {
  SPIKES: ['minSpikes', 'spikes'], BLOCKS: ['minBlocks', 'blocks'],
  DOUBLE_SPIKES: ['minDoubleSpikes', 'doubleSpikes'], TRIPLE_SPIKES: ['minTripleSpikes', 'tripleSpikes'],
  TALL_BLOCKS: ['minTallBlocks', 'tallBlocks'], TIGHT_GAPS: ['minTightGaps', 'tightGaps'],
};

// Describes the CURRENT map only. No candidate edit is executed or selected here.
export function conciseFeedback(state, requirements, detailed) {
  const r = checkRequirements(requirements), {level, report} = state;
  const priority = detailed.priority, code = priority?.code;
  const sorted = level.objects.map((o, index) => ({index, ...o})).sort((a, b) => a.x - b.x);
  const bounds = o => {
    const i = sorted.findIndex(v => v.index === o.index);
    const minX = Math.max(r.safeStart, i ? sorted[i - 1].x + sorted[i - 1].w + 1 : 1);
    const maxRight = Math.min(level.length - r.safeFinish, sorted[i + 1] ? sorted[i + 1].x - 1 : level.length);
    return {...o, minX, maxRight, availableWidth: maxRight - minX};
  };
  let targets = [], instruction = 'Change a relevant object; preserve the confirmed checks. A proposed edit still needs the whole-level validator.';
  let measurement = null;
  if (countRules[code]) {
    const [requirement, stat] = countRules[code];
    measurement = {actual: report.stats[stat], required: r[requirement], missing: r[requirement] - report.stats[stat]};
    if (code === 'DOUBLE_SPIKES' || code === 'TRIPLE_SPIKES') {
      const threshold = code === 'DOUBLE_SPIKES' ? 2 : 3;
      targets = sorted.filter(o => o.type === 'spike' && o.w < threshold).map(bounds);
      instruction = `Only spike groups with w<${threshold} can become an ADDITIONAL qualifying group. Widening a group already at w>=${threshold} does not increase this counter. Candidate indices below are not tested solutions. Respect neighbour bounds; if necessary first free space.`;
    } else if (code === 'SPIKES') {
      targets = sorted.filter(o => o.type === 'spike' && o.w < 6).map(bounds);
      instruction = 'SPIKES counts total spike width. Increase width or add a spike group; a width change must fit the neighbours and remain traversable.';
    } else if (code === 'TALL_BLOCKS') {
      targets = sorted.filter(o => o.type === 'block' && o.h < 2).map(bounds);
      instruction = 'Only blocks currently below h=2 can become an ADDITIONAL tall block. Increasing an already tall block does not increase this counter.';
    } else if (code === 'BLOCKS') {
      targets = sorted.filter(o => o.type === 'spike').map(bounds);
      instruction = 'BLOCKS counts separate block objects, not width. Add a block or convert a spike group while preserving confirmed spike requirements.';
    } else {
      targets = sorted.slice(1).map((o, i) => ({...bounds(o), gapBefore: o.x - sorted[i].x - sorted[i].w})).filter(o => o.gapBefore > 2);
      instruction = 'A new tight gap needs 1 or 2 empty tiles between consecutive groups. Do not overlap or touch groups.';
    }
  } else if (code === 'SAFE_FINISH') {
    const end = Math.max(0, ...sorted.map(o => o.x + o.w));
    measurement = {freeTiles: level.length - end, required: r.safeFinish, maximumRightEdge: level.length - r.safeFinish, excess: end - (level.length - r.safeFinish)};
    const last = sorted.reduce((best, o, i) => o.x + o.w > sorted[best].x + sorted[best].w ? i : best, 0);
    targets = sorted.slice(Math.max(0, last - 1), last + 1).map(bounds);
    instruction = `Reduce the last right edge by at least ${measurement.excess} tile(s): x+w must be <=${measurement.maximumRightEdge}. Changing type alone cannot fix this. If it cannot fit with neighbours fixed, first move/resize the preceding object.`;
  } else if (code === 'SAFE_START') {
    targets = sorted.slice(0, 2).map(bounds);
    measurement = {firstX: sorted[0]?.x ?? level.length, required: r.safeStart};
    instruction = 'Increase the first obstacle x to the required start margin; preserve spacing from the following obstacle.';
  } else {
    const indices = new Set((detailed.localIntervals || []).map(o => o.index));
    targets = sorted.filter(o => indices.has(o.index)).map(bounds);
    if (code === 'NO_PATH') {
      measurement = {furthestX: detailed.furthestX, blockers: detailed.blockers};
      instruction = 'All proxy paths stop here. Change a blocker or its approach, not a distant object. Changing x alone may leave a too-high wall impassable. Preserve required counts.';
    } else instruction = priority?.instruction || instruction;
  }
  // Rank by geometric room, never by outcomes of unexecuted edits. Include all
  // eligible indices even when the detailed descriptions are limited to eight.
  targets.sort((a, b) => Number(b.availableWidth >= (code === 'TRIPLE_SPIKES' ? 3 : 2)) - Number(a.availableWidth >= (code === 'TRIPLE_SPIKES' ? 3 : 2)) || a.index - b.index);
  return {version: TARGETED_VERSION, issue: {code, message: priority?.message || null}, measurement,
    eligibleIndices: targets.map(o => o.index), targets: targets.slice(0, 8), instruction,
    preserve: detailed.confirmedChecks, scope: 'Current-map measurements and count identities only; no corrected alternative has been tested.'};
}

export function targetedMessages(item, state, condition, history = []) {
  if (!TARGETED_CONDITIONS.includes(condition)) throw new Error('Unknown targeted study condition');
  const base = editMessages(item, state, 'actionable', condition === 'actionable' ? history : []);
  if (condition === 'actionable') return base;
  const recent = history.slice(-2).map(a => ({edit: a.edit, accepted: a.decision.accepted,
    reason: a.decision.reason, lost: a.decision.lost,
    furthestX: [a.decision.before.furthestX, a.decision.after.furthestX],
    deficit: [a.decision.before.deficit, a.decision.after.deficit]}));
  base.messages[1] = {...base.messages[1], content: base.messages[1].content.replace('Previous proposals: []', `Previous proposals: ${JSON.stringify(recent)}`)};
  const diagnostic = conciseFeedback(state, item.requirements, base.diagnostic);
  const last = history.at(-1);
  if (last?.decision.reason === 'unchanged') diagnostic.lastOutcome = 'Your last replacement was IDENTICAL to the current object. No coordinate, width, height or type changed. Return a genuinely changed object.';
  else if (last) diagnostic.lastOutcome = last.decision.accepted ? `Last edit accepted as ${last.decision.reason}; the issue below remains.` : `Last edit rejected: ${last.decision.reason}; lost checks: ${last.decision.lost.join(', ') || 'none'}. The current map did NOT change.`;
  diagnostic.avoidRepeating = recent.map(a => a.edit);
  base.messages[2] = {role: 'user', content: `Measured current validator feedback:\n${JSON.stringify(diagnostic)}\nReturn one changed object addressing this issue. Do not repeat the listed proposals.`};
  return {...base, diagnostic};
}

export async function proposeTargeted(item, state, condition, attempt, history = [], chat = ollamaChat) {
  const {messages, schema, diagnostic} = targetedMessages(item, state, condition, history);
  const generated = await chat(messages, {seed: item.editSeed + attempt, schema, temperature: .3});
  return {...generated, ...evaluateEdit(state, generated.raw, item.requirements), diagnostic,
    condition, attempt, feedbackVersion: condition === 'targeted' ? TARGETED_VERSION : 'one-object-actionable-repair-v1'};
}
