# Final experiment

The authoritative pre-inference protocol is preserved in [the captured source bundle](../results/retained-plans-2026-10-24/sources/docs/RETAINED-PLANS-PROTOCOL.md). This page explains the completed experiment in English. Earlier development series are not pooled with it.

## Design

- 12 numeric briefs in the same six known families; two seeds per brief.
- Two concrete installed Qwen profiles; 24 cases per profile.
- Two repair scopes: whole plan and one controller-selected section.
- Three proposal conditions: Qwen without diagnostic text, Qwen with measured feedback, and random repair.
- One identical actual Qwen initial plan shared by all six conditions within each model/case.
- Stop after complete initial success; otherwise at most three repair proposals. Rejected and unchanged proposals consume the budget.
- Shared library, compiler, verifier, acceptance guard, and original requirements.

This produces **288 chains**, not 288 independent tasks. The outcome is full proxy success of the retained plan, including every original requirement. Initial success and recovery of initially failing cases are reported separately.

## Models and settings

| Profile | Quantization | Recorded Ollama digest |
|---|---|---|
| `qwen3.5:4b` | Q4_K_M | `d8b0f5e9760cd1682034f292d7ef72ec46f432149be0df7574bf2d6e92e38c04` |
| `qwen3.5:9b-q4_K_M` | Q4_K_M | `56671c2ab9385f9cfcb404638e32cd62d88e3501d44822208363c010179a3c90` |

The complete bindings are in [model-bindings.json](../results/retained-plans-2026-10-24/model-bindings.json). The installed bindings report a native context of 262,144 tokens for both profiles. The actual study used **8,192 context tokens**, response cap **4,096**, temperature **0.65**, `think=false`, and timeout **360,000 ms**. The output cap does not add 4,096 tokens to the context window.

Two chains ran concurrently within each model profile; model profiles ran in serial batches on an RTX 3060 Ti with 8 GB VRAM. These are ready-made checkpoints, without weight updates, fine-tuning, or reinforcement learning.

## Results

| Condition | 4B full success / 24 | 9B full success / 24 |
|---|---:|---:|
| Whole, no text | 6 | 3 |
| Whole, feedback | 5 | 10 |
| Local, no text | 2 | 6 |
| Local, feedback | 7 | 14 |
| Random whole | 8 | 8 |
| Random local | 9 | 11 |

There were two shared initial successes for 4B and three for 9B. Among the 21 initially failing 9B cases, local no-text repair recovered 3, local feedback recovered 11, and random local repair recovered 8. For 9B, unchanged proposals were 44/61 without text and 16/48 with feedback; proposal denominators differ because success stops a chain.

## Paired statistics

Compare the two outcomes within each matched model/brief/seed case. A win means the first condition succeeds and the second fails; a loss means the reverse. Shared successes and shared failures are ties.

| Local comparison | Role | Wins / losses | Brief-cluster p | Family sensitivity p |
|---|---|---:|---:|---:|
| 4B feedback vs no text | Sole primary | 5 / 0 | 0.125 | 0.25 |
| 9B feedback vs no text | Secondary | 8 / 0 | 0.015625 | 0.03125 |
| 9B feedback vs random | Secondary | 4 / 1 | 0.375 | 0.25 |

The code uses an exact two-sided sign-flip calculation on summed paired differences. The main grouping is by the 12 briefs, keeping their two seeds together. The sensitivity calculation groups by the six related families. These are conditional calculations under label-exchangeability/symmetry assumptions, not population randomization guarantees. Family grouping is a sensitivity analysis; its p-value is not necessarily larger.

The primary comparison was fixed as 4B local feedback versus local no text and remains inconclusive. The 9B numbers are nominal and exploratory after method development, without an adjustment that turns the historical search into independent confirmation. General superiority over random repair is not established. Scope comparisons also differ in output size and controller information; they are not equal-token-budget comparisons.

## Audit and computation

Offline replay verified all 288 chains and 21 frozen source files. The journals contain 527 actual requests and 527 completed responses, no API errors, and no response-cap hits. There were 48 unique initial calls and 479 model repair calls. Reusing shared initial answers accounts for 240 cached logical uses. The 226 random repair proposals require no model calls. Recorded actual usage is 594,172 input tokens and 26,378 output tokens.

For 9B local feedback, 14 successes contain 13 distinct geometries, with mean tokenized geometry Jaccard distance about 0.809. This does not measure visual quality, enjoyment, or human difficulty.

## Run a new experiment

```bash
ollama pull qwen3.5:4b
ollama pull qwen3.5:9b-q4_K_M
npm run study -- --out artifacts/new-study --prepare true
npm run study -- --resume artifacts/new-study
```

This uses the frozen runner, prepares the fixed bank, binds installed model digests, and performs new inference. It is a separate run and may take substantial time. Preparation checks feasibility and requires the 4B model to be installed; a missing 9B profile remains pending. Resume checks source hashes, bank hashes, model bindings, and settings. Review current tag digests against the recorded bindings before claiming an exact model match. See [reproducibility](reproducibility.md).

