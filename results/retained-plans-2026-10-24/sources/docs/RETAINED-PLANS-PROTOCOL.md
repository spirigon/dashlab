# Retained plans, local repairs and model size — fixed before inference

Exploratory extension after the 360-chain sweep. All earlier data/archives remain unchanged. Twelve new numeric configurations in the SAME six task families and fixed library, two new seeds per brief. The full new bank is fixed before inference; known solutions only establish feasibility, remain hidden and never replace generated failures. One brief cannot meet old intermediate quarter quotas; a separate count-filtered exhaustive feasibility search is used, without weakening its final requirements.

Two model profiles: existing qwen3.5:4b (never repulled) and official qwen3.5:9b-q4_K_M. Each model digest is bound before its first inference and checked on resume. The 9B profile may still be downloading when preparation/4B batch begins; it stays pending until installed. Availability is independent of outcomes; never silently exclude the unavailable profile or call a partial run complete. Official download may use IPv4 and local /api/blobs import with SHA256 checks if default IPv6 transfer fails. No global networking changes.

24 cases/profile × 6 arms × 2 profiles = **288 chains**. Case seed=501000+1000*(briefIndex*2+replica). Each model/case has one identical initial Qwen complete four-section plan shared by ALL SIX arms. No selected/damaged initial levels. If initial passes, zero repairs. Otherwise at most THREE repairs (seed=caseSeed+500+attempt). Temperature .65, think=false, context8192, structured num_predict4096, timeout360000ms. Same generation prompt across models; repair prompts differ only in scope and diagnostic treatment.

## Six arms

- whole_none / whole_feedback: revise the whole four-section plan, without/with short measured errors plus static substitution tradeoffs.
- local_none / local_feedback: revise exactly ONE controller-selected section with other three literal sections frozen, without/with the SAME diagnostic treatment.
- whole_random / local_random: the SAME Qwen initial plan, uniform random replacement in the matching whole/local plan schema, same three-proposal budget and guard. These are RANDOM REPAIRS, not random generation from empty.

All arms share the existing decideEdit acceptance rule: preserve confirmed schema/path/rule checks, reject earlier failure position when both paths fail, reject larger numeric deficit when reachability is unchanged, reject invalid and unchanged proposals. Neutral preparations may be retained but do not count as strict improvement. A rejected edit leaves the retained plan unchanged. Full success stops calls. The guard is a controller property; zero regressions do not by themselves show improved LLM reasoning.

Local target selection is common controller information even in local_none: first failed-path section; literal current bounds error if compilation fails; otherwise maximal static headroom for deficient counters; rotate for a minimum-jumps-only deficit. No tested alternative is supplied. This shared localizer makes none an absence of the TEXT diagnostic, not absence of all execution feedback. Cross-scope effects combine output size and selection/controller information; do not call them a pure feedback effect.

Two concurrent chains within a model profile; all 4B chains finish/unload before 9B. Exact identical in-flight/completed requests shared and journalled. API errors remain in denominators. Interrupted requests may resume only with identical hashes. Missing models remain pending; outputs/caps/time/errors all reported. No outcome-driven prompt/budget/task edits or early stopping for a positive result.

## Endpoint and analysis

Complete original requirements AND full path in unchanged cube-proxy-v1, using the final RETAINED plan. Per-arm denominator24; report initial passes, initially failed cases and recovered cases separately. Do not credit feedback for an initial success. Also report monotonicity violations, rejected/neutral edits, noops, diversity, native-ready examples, model calls/tokens/time and output caps. Native-game playability is not inferred.

Sole primary comparison: **4B local_feedback vs local_none**. Matched wins/losses and conditional sign test over twelve numeric briefs, with six-family sensitivity because briefs reuse related families. 9B replication and all whole/local/random/model comparisons are secondary/descriptive. Do not pool models or old studies. No statistical claim from whichever cell wins. Twelve related configurations are not twelve new task families. Prespecified full table includes failed hard cases.

Audit from frozen sources: every available full chain and exact prompt/options/hash, identical initial responses, unchanged unselected local sections, guard decisions and rejected-state retention, stop-after-success, random distributions and budgets. Store raw model responses, feasibility checks and bindings. A partial audit is explicitly named analysis-partial.json; final analysis.json requires all288assignments. Demonstration examples selected post-outcome are illustrations, not independent evaluation. Build a saved before/after demo only from actual responses, displaying measured error and actual source/model.
