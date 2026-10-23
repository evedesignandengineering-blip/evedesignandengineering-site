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

Regression cases and expected aggregation are in `tests/CU-CALLOUT-REGRESSION.txt`.
