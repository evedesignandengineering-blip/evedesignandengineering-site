# Stable backup — EVE Drawing & Quote Checker V116

Stable branch: `stable/drawing-quote-checker-model-fallbacks-v116`

Supabase deployment at snapshot: `ai-drawing-quote-check` v116, status ACTIVE. Project: `hszkloepnewfkzdegfhl`.

## Fallback order
1. `gemini-3.1-flash-lite` and `gemini-3.5-flash-lite`
2. `gemini-3.8-flash` and `gemini-3.6-flash`
3. `gemma-4-26b-a4b-it` and `gemma-4-31b-it`
4. `gemini-3.7-flash`, `gemini-3-flash-preview`, `gemini-2.5-flash-lite`, and `gemini-2.5-flash`

The first two batches retain their previous order. Gemma 4 uses `thinkingLevel: minimal` for the API configuration; Gemini models use `low`. Individual model requests time out after 23 seconds. The overall fallback window is now 100 seconds so batch 4 can run after the earlier batches fail.

## Restore
The full website repository at this snapshot is on this branch. Standalone copies under `backups/model-fallback-ladder-v116/` include the checker frontend, backend function source, stylesheet, and snapshot manifest. For a backend rollback, redeploy this `index.ts` to Supabase project `hszkloepnewfkzdegfhl` function `ai-drawing-quote-check`. Secrets are not copied into GitHub.
