# EVE Drawing & Quote Checker — Stable Backup V1.68

This is the protected restore point created before the depot-coordinate/travel-comparison repair.

## Stable snapshot
- Full website repository snapshot branch: `stable/drawing-quote-checker-v1.68`
- Frontend version: V1.68
- Supabase Edge Function at backup time: `ai-drawing-quote-check`, deployed version 113 (ACTIVE)
- Supabase project: `hszkloepnewfkzdegfhl`
- Gemini model priority retained: `gemini-3.1-flash-lite`, `gemini-3.5-flash-lite`, then `gemini-3.8-flash`, `gemini-3.6-flash`.

## Standalone copies
- `drawing-quote-checker.html`: exact V1.68 frontend
- `index.ts`: exact active Supabase Edge Function source at backup time
- `styles.css`: shared website stylesheet used by the frontend
- `snapshot.json`: hashes/version information and restore notes

## Restore guidance
1. Keep this branch unchanged as the stable reference.
2. Restore frontend changes from the root `drawing-quote-checker.html` in this branch, plus `styles.css` when needed.
3. Restore the backend source from the root `supabase/functions/ai-drawing-quote-check/index.ts` in this branch and redeploy it to the same Supabase project/function.
4. Do not place secret keys in GitHub. The deployed function uses the existing Supabase function secrets.

This backup records code and configuration identifiers, not uploaded project drawings or quote PDFs.
