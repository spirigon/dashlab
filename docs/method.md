# Method

## Task and representation

The goal is to produce a playable level prototype that meets numeric requirements, then repair failures using external measurements. The final study uses ordinary cube autorun over a solid floor.

Each plan has four sections, `s1` through `s4`. The task schema fixes section boundaries, slot counts, and allowed extras. Qwen chooses pattern names and their order. A local proposal replaces exactly one section; the other three plans remain literally unchanged.

The measured library has **eight templates**, built from two primitive types, blocks and spikes:

| Kind | Names | Fixed geometry |
|---|---|---|
| Motifs | `triple_pair` | Two triple-spike groups, width 8 tiles |
| Motifs | `stairs` | Two block groups, heights 1 and 2, width 6 tiles |
| Motifs | `tower_triple` | A height-2 block and a triple-spike group, width 6 tiles |
| Optional extras | `single_spike`, `double_spike`, `triple_spike`, `block`, `tall_block` | One fixed extra group |

There are five empty tiles after each motif. `none` means no extra and is not a ninth template. The compiler supplies coordinates. This limits the search space and is part of the method, not an ability learned by Qwen.

## Search and rule checks

The measured simulator is `cube-proxy-v1`: 120 Hz, fixed horizontal speed about 10.39 tiles/s, cube bounds 0.8 × 0.9 tiles, ground jump height about 2.14 tiles, and same-height jump range about 4 tiles. Jumping is allowed only while grounded. Landing on a block top is allowed; block side/head collisions and spike collisions are fatal. No portals, speed changes, moving objects, or reversed gravity are included.

The solver searches time layers over discrete states. Horizontal position is shared within a layer. Equivalent height/vertical-speed/grounded states are merged, keeping the path with fewer jumps. A successful action sequence is replayed in the same engine. The default budget is 600,000 considered state variants, not 600,000 unique states.

- `PASS`: a path and all original requirements pass.
- `NO_PATH`: the search frontier was exhausted in the supported model.
- `SEARCH_BUDGET`: the computation stopped at the resource limit; the result is inconclusive.

Rules separately check structure and bounds, exact length, spike and block counts, double/triple groups, tall blocks, tight gaps, safe boundaries, and minimum jumps. Minimum jumps is a property of the search model, not a human difficulty rating.

## Feedback and random repair

Model-based repairs always use Qwen. The no-text condition receives the plan, requirements, library, shared local target when applicable, and previous binary acceptance decisions. The feedback condition adds measured deficits, failed-path position, and static substitution tradeoffs. It does not receive a separately tested successful replacement or an LLM critic.

Random repair calls no model for the replacement. A seeded pseudorandom generator chooses allowed pattern names uniformly within the same schema. It still starts from the shared Qwen initial plan and uses the same localizer, verifier, and guard. Therefore it is an informed controller with random proposal content, not completely blind generation.

## Acceptance guard

Every condition uses the same guard. It rejects invalid and unchanged proposals, loss of confirmed checks, earlier failure when both paths fail, and a larger numeric deficit when reachability is unchanged. Neutral preparations may be accepted. Rejection preserves the previous plan; complete success stops inference.

The guard blocked 182 regressive proposals in the study. This makes zero lost checks in retained states a controller property, not evidence that the model never made harmful proposals. The guard can also block a temporary sacrifice that might have enabled a later repair.

