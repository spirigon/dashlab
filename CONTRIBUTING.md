# Contributing

Use Node.js 22 or newer. Before proposing a change, run `npm ci`, `npm run check`, `npm test`, and `npm run reproduce`. The application has no npm runtime dependencies. Python and Matplotlib are optional for charts.

Keep UI strings and maintained documentation in English. Captured evidence, frozen sources, and original fixture text must remain verbatim. Do not translate, reformat, or repair recorded model outputs. Never commit `.env`, model weights, local playtest journals, or generated `artifacts/` directories.

## Changing the method

Do not edit `results/retained-plans-2026-10-24/` to fit a new implementation. Version a new protocol, bank, source snapshot, model bindings, and run directory. Preserve failed assignments, rejected edits, and infrastructure errors in their denominators. Keep model proposals separate from deterministic compiler/guard work and hidden feasibility witnesses.

The maintained application modules may evolve. Historical replay deliberately imports the frozen source bundle. If a physics, search, schema, prompt, or guard change is intentional, explain how it affects new runs and add a focused behavioral test. Do not silently reinterpret the final study using a changed engine.

## Scope of this repository

This is a curated research release of the final study and working application. Earlier result batches, packaging experiments, slide-generation sources, and obsolete runners remain in the original development workspace and are intentionally excluded. The original full development suite had broader historical-runner coverage; this repository maintains the applicable core/application tests and adds repository reproducibility checks.

