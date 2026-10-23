# Stable restore point: before AUX_005 total-calculation correction

- Branch: `stable/pre-aux005-total-calculation-v114`
- Frontend: current checker source before changing AUX_005 basis.
- Backend: exact active Supabase Edge Function v114 source.
- Supabase project: `hszkloepnewfkzdegfhl`
- Function: `ai-drawing-quote-check`

This branch is a full repository snapshot. The `backups/aux005-before-total-calculation-v114/` folder additionally includes standalone copies of the frontend, backend, and a JSON manifest.

The pre-change AUX_005 helper uses the DQM "Compatible Units" summary amount. This restore point was created because the user confirmed AUX_005 must use the DQM Cost Summary "Total" first column, i.e. Total Internal Costs (SP053602: $23,308.88).

Restore frontend/backend from this branch if needed. Backend rollback requires redeploying the saved `index.ts` to the same Supabase project/function. Function secrets are not stored in GitHub.
