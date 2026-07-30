# TKO Forge Fulfillment

## Goal

Turn a creator's approved forged artifact into a physical T-shirt that can be
sold from TKO, manufactured on demand, shipped by a print-on-demand provider,
and tracked back to the creator without the creator managing inventory.

## System ownership

- **TKO:** forged artifact, creator/clan identity, artwork review, creator
  eligibility, profit-share calculation, payout ledger, and the in-app UX.
- **Stripe + TKO:** embedded checkout, tax calculation, refund source of truth,
  platform revenue, and the delayed creator-payout ledger.
- **Shopify:** draft physical product/variant catalog and a mirrored paid-order
  operations record. Buyers remain inside TKO.
- **Print-on-demand provider:** blank garment, printing, packaging, carrier,
  tracking number, replacement workflow, and production cost.
- **Stripe Connect:** creator payout destination. The TKO platform charge is
  settled first; TKO transfers only the creator's audited share after the
  refund reserve window.

## First T-shirt workflow

1. A creator forges or selects a digital artifact in TKO.
2. They choose **Make it physical**, select T-shirt, and submit artwork.
3. TKO checks seller eligibility, image resolution, transparent background,
   rights attestation, prohibited content, and minimum safe price.
4. The product enters `pending_review`; it cannot publish automatically.
5. Approval changes it to `approved`.
6. The TKO Shopify bridge creates a **draft** Shopify product with Black
   S/M/L/XL/2XL variants and TKO provenance metafields.
7. An operator maps the variants to a provider's shirt/print area once.
8. The product becomes purchasable in TKO; Shopify publication is optional and
   is never performed by the bridge.
9. TKO embeds Stripe checkout and collects the buyer's address, tax, and
   payment without sending the buyer to Shopify.
10. A verified Stripe webhook marks the TKO order paid and mirrors a paid,
    unfulfilled, test-safe order into Shopify.
11. TKO creates a provider draft. Production still requires an explicit
    fulfillment confirmation gate.
12. Provider/Shopify webhooks update the in-app TKO order timeline.
13. TKO releases the creator's margin share after the refund reserve window.

## Money rule

Creator share is a percentage of **distributable margin**, not gross revenue:

`sale - manufacturing - shipping - payment fees - refund reserve`

If the result is zero or negative, the creator and platform shares are both
zero and the product should fail the minimum-price check before publication.

## Shopify app

The Shopify CLI app lives at:

`integrations/shopify-tko/tko-forge-fulfillment`

Environment variables that will be needed after the dev store is selected:

- `SHOPIFY_API_KEY`
- `SHOPIFY_API_SECRET`
- `SCOPES`
- `SHOPIFY_APP_URL`
- `TKO_WEBHOOK_FORWARD_URL`
- `TKO_SHOPIFY_BRIDGE_SECRET`
- `TKO_SHOPIFY_SHOP_DOMAIN`
- `TKO_SHOPIFY_TEST_ORDERS=1`

Do not put secrets in the Vite frontend or commit `.env` files.

The TKO API additionally needs `SHOPIFY_BRIDGE_URL`. Every external write is
fail-closed behind `MERCH_MODE=live` plus its own `MERCH_ALLOW_*` switch. The
default local mode is `simulate`; it never calls Stripe, Shopify, or Printful.

## Provider decision

Start with one provider and one garment. Compare Printful, Printify, and Gelato
on API access, United States production time, embroidery/DTG quality,
white-label packaging, replacement handling, and per-variant cost. Keep the
provider behind TKO's own product/variant tables so it can be changed later
without changing artifact ownership or creator payouts.

## Launch gates

- Development store and app installation complete.
- One provider connected to that development store.
- One sample shirt ordered end-to-end in the development store before any
  production switch is enabled.
- Webhook signature checks and idempotency tested.
- Refund/cancellation reverses unpaid creator earnings; a post-payout refund
  enters operator review until the transfer-reversal policy is confirmed.
- Tracking appears inside TKO.
- Rights attestation and content review are in the creator submission.
- Sales-tax, returns, privacy, and creator-payout terms reviewed for launch.
