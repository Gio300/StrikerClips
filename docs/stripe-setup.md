# Stripe Connect setup

ReelOne uses **Stripe Connect (Express)** for tips. Each creator onboards once
through Stripe-hosted forms, money is collected via Stripe Checkout, and a
small `PLATFORM_FEE_BPS` is split out as our cut (default 5%). Stripe handles
1099s, KYC, payouts, refunds, and chargebacks.

## What ships in the repo

| Surface | File |
| --- | --- |
| DB schema | [supabase/migrations/012_live_chat_donations_uploads_labels.sql](../supabase/migrations/012_live_chat_donations_uploads_labels.sql) |
| Donate UI | [src/components/DonateButton.tsx](../src/components/DonateButton.tsx) |
| Payouts card | [src/components/CreatorPayoutsCard.tsx](../src/components/CreatorPayoutsCard.tsx) |
| Connect onboarding | [supabase/functions/stripe-connect-link](../supabase/functions/stripe-connect-link) |
| Checkout session | [supabase/functions/donations-create](../supabase/functions/donations-create) |
| Webhook receiver | [supabase/functions/donations-webhook](../supabase/functions/donations-webhook) |

The browser feature flag is `VITE_STRIPE_PUBLISHABLE_KEY`. Without it, the UI
shows a "donations setup pending" pill instead of a tip button.

## One-time setup

1. **Create a Stripe account** in test mode: <https://dashboard.stripe.com/register>.
2. **Enable Connect** for your account: <https://dashboard.stripe.com/connect/accounts/overview>.
   Pick **Express**.
3. Grab your **publishable** and **secret** keys from
   <https://dashboard.stripe.com/test/apikeys>.
4. **Set Supabase secrets** (replace `<...>`):

   ```bash
   supabase secrets set STRIPE_SECRET_KEY=sk_test_...
   supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...
   supabase secrets set APP_URL=https://reelone.app
   supabase secrets set PLATFORM_FEE_BPS=500   # 5% — adjust to taste
   ```

5. Deploy the three Edge Functions:

   ```bash
   supabase functions deploy stripe-connect-link
   supabase functions deploy donations-create
   supabase functions deploy donations-webhook --no-verify-jwt
   ```

   The webhook intentionally has `--no-verify-jwt` because Stripe doesn't send
   our JWTs — instead the function verifies the Stripe signature manually.

6. **Create a webhook endpoint** in Stripe pointing at the deployed function:

   ```
   https://<project-ref>.supabase.co/functions/v1/donations-webhook
   ```

   Subscribe to these events at minimum:
   - `checkout.session.completed`
   - `payment_intent.succeeded`
   - `payment_intent.payment_failed`
   - `checkout.session.expired`
   - `account.updated`

   Copy the signing secret into `STRIPE_WEBHOOK_SECRET`.

7. Add `VITE_STRIPE_PUBLISHABLE_KEY=pk_test_...` to your frontend env.

## Manual smoke test

1. Sign in as creator A.
2. Open `/dashboard` → "Connect Stripe" → finish the express onboarding form.
3. Stripe redirects back. The card now shows "Active".
4. In a different browser, sign in as creator B.
5. Visit creator A's profile, hit "Tip" → enter $5 → Stripe Checkout opens.
6. Use card `4242 4242 4242 4242` with any future date / any CVC.
7. Webhook fires → creator A's `/dashboard` shows the tip in seconds.

## Going to production

- Switch keys to the `sk_live_` / `pk_live_` versions.
- Stripe will require you to provide a public business name + support email.
- Set `APP_URL` to your real domain so onboarding return URLs land users back
  on `/dashboard`.
