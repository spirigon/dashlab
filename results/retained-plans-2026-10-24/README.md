# Recorded final experiment

This directory is the immutable evidence bundle for the final 288-chain study.

| File | Role |
|---|---|
| `runs.jsonl` | All assigned chain outcomes, retained states, proposals, and guard decisions |
| `calls.jsonl` | Actual requests/responses, request hashes, explicit cache reuse, model options and costs |
| `metadata.json` | Design, physics, settings, source hashes, and primary comparison |
| `cases.json`, `jobs.json` | Fixed 24 cases per model and all 288 assignments |
| `model-bindings.json` | Exact installed model digests and quantization metadata |
| `hidden-feasibility.json` | Feasibility witnesses that were not provided to the model |
| `sources/` | 21 original source files, preserved byte-for-byte |
| `analysis.json`, `metrics.csv` | Recorded outputs, independently recomputed by `npm run reproduce` |
| `summary.json`, `progress.json` | Captured runner completion state |

See the English [experiment guide](../../docs/experiments.md) and [reproduction guide](../../docs/reproducibility.md). The pre-inference protocol is [preserved verbatim](sources/docs/RETAINED-PLANS-PROTOCOL.md).

The later native-game self-report is stored separately in `../native-playtest.json`; it does not change these results. Do not edit captured prompts, messages, or source files to translate them. The dataset deliberately includes original-language text.

