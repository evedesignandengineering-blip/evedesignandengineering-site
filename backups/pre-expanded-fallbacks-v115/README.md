# Backup before expanding the AI fallback ladder

- Branch: `stable/pre-expanded-model-fallbacks-v115`
- Supabase Edge Function version captured: 115
- Existing fallback batches at backup: 
  1. `gemini-3.1-flash-lite` and `gemini-3.5-flash-lite`
  2. `gemini-3.8-flash` and `gemini-3.6-flash`

This branch is a full repository snapshot from immediately before the new fallback batches were added. Standalone copies of the frontend, backend function, stylesheet, and a manifest are stored in `backups/pre-expanded-fallbacks-v115/`.

To roll back the backend, redeploy this folder's `index.ts` to Supabase project `hszkloepnewfkzdegfhl`, function `ai-drawing-quote-check`. To roll back site files, restore the copies from this branch. Function secrets are not included in this backup.
