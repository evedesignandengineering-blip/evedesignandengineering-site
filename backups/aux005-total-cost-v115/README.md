# Stable restore point: AUX_005 uses DQM Total Internal Costs

- Branch: `stable/drawing-quote-checker-aux005-total-v115`
- Active backend at backup: Supabase Edge Function version 115 (ACTIVE)
- Frontend version: Checker version V1.68
- AUX_005 basis: DQM Cost Summary **Total** row, first-column **Total Internal Costs**.
- Calculation: expected AUX_005 = 4 × ceil((DQM Total Internal Costs − quoted AUX_005 qty × $174.13) / $10,000), minimum 0.

## Regression examples
- SP053602: $23,308.88 total; 12 AUX_005 quoted; subtract $2,089.56; adjusted $21,219.32; expected 12 — PASS.
- SP053242: $115,298.30 total; 48 AUX_005 quoted; subtract $8,358.24; adjusted $106,940.06; expected 44 — MISMATCH.

## Restore
This branch contains the entire repository snapshot plus exact standalone frontend/backend/styles copies under this folder. To restore backend behavior, redeploy the saved `index.ts` to the same Supabase project/function. No secret keys are included in GitHub.
