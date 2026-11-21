# KATAWA Paystack integration (test first)

This branch adds Paystack hosted checkout for ready-to-wear purchases and 50% custom-order deposits. The service-side **Paystack API secret** is never placed in HTML/GitHub. Both guest and authenticated customers can pay. Paystack sends settlements to the nominated I&M account configured in your own Paystack Dashboard; this repository does **not** contain bank details.

## Prerequisites
1. Make sure Paystack has approved your Kenya Starter Business account and saved your I&M personal bank settlement account.
2. In Supabase Dashboard → SQL Editor, run **supabase/migrations/20261121_paystack_checkout.sql**. The migration seeds server-authoritative product prices, locks down direct order insertion/updates, and adds payment references/statuses. Check the stock/prices against the live catalog.
3. Supabase Dashboard → Edge Functions → Secrets: set `PAYSTACK_SECRET_KEY` to the **test** secret key from Paystack, and `KATAWA_SITE_URL` to your actual HTTPS site URL (for example `https://katawa.kamalitamara.me/`). Do not paste keys into code or chat. The Supabase Functions runtime supplies `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` when available; confirm they are set in your environment.
4. Deploy `paystack-init`, `paystack-confirm`, `paystack-webhook` Edge Functions with **JWT verification disabled** (they implement their own request/payment validation). Supabase CLI example: `npx supabase functions deploy paystack-init --no-verify-jwt`; repeat for the other two functions.
5. In Paystack Dashboard → Settings → API Keys & Webhooks, configure the **test webhook URL** as `https://<your-project-ref>.supabase.co/functions/v1/paystack-webhook`. Never configure a webhook secret unless you also set the matching `PAYSTACK_WEBHOOK_SECRET` in Supabase Secrets. The code supports Paystack's documented `x-paystack-signature` fallback signature. Test webhook delivery.
6. Deploy the website containing the updated HTML. If running Docker, `Dockerfile` serves `index-local.html`. Test both shopping and custom orders, completed, cancelled, and failed payments, and check the paid status in Supabase. Do not fulfill an order solely because a customer returned from checkout.

## Production
After fully verifying test transactions and payment amounts, replace the test secret with the **live** Paystack secret in Supabase Secrets, configure Paystack's **live webhook**, and redeploy. Confirm that Paystack is activated, M-Pesa/cards are enabled in your Paystack account, and your I&M settlement account is verified.

## Technical notes
- The backend calculates totals from `katawa_catalog` and `katawa_custom_prices`, not browser amounts. Delivery costs KES 250 in Nairobi / KES 400 elsewhere, waived when subtotal > KES 10,000.
- Paystack initialization uses KES **subunits** (amount in cents); successful payments are matched to the expected reference, currency, amount, and email using the Paystack verify API.
- The webhook is signed and calls the same verification function; browser return is only a secondary reconciliation path. Status updates are idempotent. Pending/failed initialization orders remain in database for troubleshooting; keep operations/admin visibility in mind.
- The customer supplies an email for Paystack receipts and may use a different contact method for delivery.
- Browser order update/insert permissions are revoked by the migration to prevent marking unpaid orders paid. Older Daraja frontend code is replaced; the legacy functions are retained but no longer called by the site.
- If the domain is hosted somewhere other than Docker or your deployed frontend, update that hosting source as well.
