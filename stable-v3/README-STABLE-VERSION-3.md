# EVE Stable Version 3 — Test Copy

This directory is the test copy of the website. The main website's root pages have not been replaced by this copy.

## Test links
- Home: /stable-v3/
- Drawing & Quote Checker: /stable-v3/drawing-quote-checker.html
- Tools: /stable-v3/tools.html
- GIS SOW Designer: /stable-v3/gis-sow/

## Isolated functions
- Drawing & Quote Checker uses Supabase Edge Function `ai-drawing-quote-check-v3`.
- GIS SOW Designer uses Supabase Edge Function `gis-ai-sow-v3`.
- The production functions retain their original slugs and source code.

The test functions are separate function deployments but currently share the existing Supabase project, its configured provider secrets, and provider quota. The Project Tracker page also uses the existing project's database/auth; do not use tracker actions for test data. A truly separate database/Auth project requires separate Supabase project setup and secret/key configuration.

## CU extraction correction
The test backend does not discard an AI-proposed drawing CU merely because the model's short evidence field omitted the literal `CU:` label. It checks the complete extracted drawing text for the code/quantity inside explicit CU blocks; `NON CU:` and `DCSH:` blocks remain excluded. Text-confirmed repeated codes are aggregated from source text rather than adding the same aggregate multiple times.

Code-recognition now handles unique lookalike matches for S/5, I/1/L, O/0/Q, Z/2, B/8 and G/6. It changes at most two glyphs, only when the cleaned code lengths match and there is exactly one DQM/source reference candidate. The original detected token and correction are preserved in the report. Exact valid codes win, and ambiguous lookalikes remain uncorrected for manual review. Parsed DQM CU rows are the primary reference; AI-read quote codes are used only when parsed quote text cannot supply a unique candidate.

Regression cases and expected aggregation/code correction behaviour are in `tests/CU-CALLOUT-REGRESSION.txt`.


## Single-area upload and project summary
The Stable V3 checker has one shared multi-file PDF drop zone. Users can drop both files together or add them one at a time; the test page inspects filenames and PDF text to identify the design drawing and DQM quote, then assigns them to the existing internal document roles. After a successful comparison, the upload card replaces the initial instructions with detected project/designer/address and nearest-depot distance details. This change is limited to the Stable V3 test checker.
