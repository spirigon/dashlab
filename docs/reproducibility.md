# Reproducibility

## Two different promises

**Offline replay** is the reproducible result supplied here. It reconstructs the recorded experiment using exact captured responses and frozen code, and compares the complete regenerated analysis and CSV to the committed reference. It does not require model weights, Ollama, a GPU, the game, Python, or internet access.

**New inference** runs the model again. Matching seeds, model digests, and settings is necessary for a comparable run but does not promise identical generation across inference engines, hardware, or versions. New outcomes must remain separate from the recorded study.

## Clean checkout

Install Node.js 22 or newer. The application and Node tests have no third-party runtime dependencies. `npm ci` verifies the minimal lockfile and provides the usual clean-install workflow.

```bash
git clone https://github.com/spirigon/dashlab.git
cd dashlab
npm ci
npm run check
npm test
npm run reproduce
```

`npm run check` verifies JavaScript syntax, JSON, documentation links, obvious accidental credentials, and evidence hashes. Tests use local fixtures and model stubs, not a running LLM. Git attributes preserve frozen source bytes on Windows and Unix.

`npm run reproduce` copies the study into a new `artifacts/replay-*` directory, executes the original offline analyzer, and checks exact structural equality of `analysis.json` and byte equality of `metrics.csv`. Expect:

```text
status: PASS
verifiedChains: 288
analysisMatchesRecorded: true
metricsMatchRecorded: true
modelRequests: 0
originalDataModified: false
```

The actual output is JSON. `audit.log` contains the analyzer output, and `reproduction.json` contains the compact result. Choose a named new directory with `npm run reproduce -- --out artifacts/my-replay`; existing destinations are refused. CPU speed determines replay duration. All original searches and guard decisions are recomputed.

## What is checked

- SHA-256 and sizes in `results/MANIFEST.json`.
- The original 21 source hashes, fixed case bank, jobs, and hidden feasibility records.
- Every actual prompt, structured schema, seed, temperature, context, response cap, and model binding.
- Every reconstructed chain outcome, including failures and rejected proposals.
- Shared initial answers across all six conditions and explicit journalled cache reuse.
- Literal preservation of the other three sections in local repairs.
- Guard decisions, retained states, repair cap, and stopping after success.
- Complete aggregate analysis, paired comparisons, token counts, and CSV metrics.

## English figures

Python is optional and only needed to rebuild plots. Use Python 3.11 or newer and an isolated environment:

```bash
python -m venv .venv
```

Activate it with `source .venv/bin/activate` on Unix or `.venv\Scripts\Activate.ps1` in PowerShell, then:

```bash
python -m pip install -r requirements-plots.txt
python scripts/plot-results.py --out artifacts/figures
```

The script reads the committed study and writes English PNG/SVG/PDF plots. Chart values are reproducible; PDF metadata and font/raster rendering can vary between environments. Existing English report figures are in `docs/assets/`.

## New model runs

Copy `.env.example` to `.env`, install the model profiles, and use the [study commands](experiments.md#run-a-new-experiment). The wrapper enforces context 8192 and timeout 360000, launches frozen code, and restricts output to `artifacts/`. No command overwrites the committed study.

To audit a new completed run, use its captured analyzer on that new directory:

```bash
node artifacts/new-study/sources/scripts/analyze-retained-plans.js artifacts/new-study
```

For a deliberately incomplete run, append `--partial`; the result is explicitly named `analysis-partial.json` and is not the final 288-chain analysis. Current Ollama tags may differ from the recorded digests. Model weights are not bundled. The historical Ollama binary, exact driver, and full hardware environment were not archived, so fresh bit-identical inference is not claimed.

## Continuous integration

GitHub Actions runs source/data checks and tests on Windows and Linux, plus an independent full replay and English figure build on Linux. No model API calls or GPU jobs run in CI. The workflow pins action commits and the plotting dependencies. Raw data hashes are checked before and after replay.

