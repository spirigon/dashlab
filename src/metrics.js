import { diversity } from '../public/engine.js';

export function summarize(rows) {
  const modes = [...new Set(rows.map(r => r.mode))];
  return modes.map(mode => {
    const group = rows.filter(r => r.mode === mode), n = group.length;
    const last = r => r.attempts.at(-1);
    const completed = group.filter(r => !r.error);
    const successes = group.filter(r => !r.error && last(r)?.report.passed);
    const schema = group.filter(r => last(r)?.report.schemaValid);
    const playable = group.filter(r => last(r)?.report.playable);
    const fraction = v => n ? v / n : null;
    const levels = schema.map(r => last(r).level);
    const validLevels = successes.map(r => last(r).level);
    return {
      mode, n, completed: completed.length, infrastructureErrors: n - completed.length,
      schemaRate: fraction(schema.length), proxyPlayableRate: fraction(playable.length),
      successRate: fraction(successes.length),
      ruleRate: fraction(group.reduce((sum, r) => {
        const rules = last(r)?.report.rules || [];
        return sum + (rules.length ? rules.filter(x => x.passed === true).length / rules.length : 0);
      }, 0)),
      meanRepairsUsed: n ? group.reduce((sum, r) => sum + Math.max(0, r.attempts.length - 1), 0) / n : null,
      meanRepairsToSuccess: successes.length ? successes.reduce((sum, r) => sum + r.attempts.findIndex(a => a.report.passed), 0) / successes.length : null,
      censoredFailures: n - successes.length,
      diversityAllSchemaValid: diversity(levels), diversitySuccessful: diversity(validLevels),
      meanLogicalCalls: n ? group.reduce((s, r) => s + r.attempts.reduce((a, t) => a + 1 + Number(Boolean(t.critic)), 0), 0) / n : null,
      meanLogicalMs: n ? group.reduce((s, r) => s + r.attempts.reduce((a, t) => a + (t.elapsedMs || 0) + (t.critic?.elapsedMs || 0), 0), 0) / n : null,
    };
  });
}
