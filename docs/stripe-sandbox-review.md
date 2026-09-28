# Stripe sandbox review

Reviewed September 27, 2026, before live payments were enabled.

## Planner outcome

Stripe MCP account: `acct_1UKT1iHanCCp0Bgn` (Roombai sandbox, `livemode=false`).
Accepted implementation guide: `iguide_61VTr5fcud3IVLP2r41HanCCp0Bgn`.
Selected path: Stripe only → web browser → ordinary advertising service (no Managed Payments eligibility assumption) → standard checkout → integrated checkout → Stripe-hosted Checkout.

Use Checkout Sessions in one-time `payment` mode. Reserve the named square in D1, price it on the server, redirect to Stripe's returned URL, and publish only after verified payment confirmation. Do not use subscriptions, Connect, or client-supplied prices. Payment methods follow Stripe Dashboard configuration. The publishable key is not required by this redirect integration.

References: [hosted Checkout](https://docs.stripe.com/payments/accept-a-payment?payment-ui=checkout&ui=stripe-hosted), [fulfillment](https://docs.stripe.com/checkout/fulfillment), [webhook signatures](https://docs.stripe.com/webhooks#verify-events).

## Review and changes

- Existing implementation matches the recommended architecture: server prices, atomic reservation, Stripe idempotency, signature verification on the raw body, paid-status and amount/currency validation, asynchronous success/failure handling, expiry and authenticated renewal.
- Added an explicit API-key environment guard: test mode rejects live keys and live mode rejects test keys before a Stripe request.
- Checkout metadata now includes the accepted terms version and order creation/acceptance timestamp.
- Added a restricted Content Security Policy, no-referrer policy, no-store and nosniff headers for the sponsor page. No card data passes through the app server.
- Fixed inherited desktop navigation margins that clipped the brand/back link. Updated management help to support@nottifai.com.
- The checkbox links to the published privacy and sponsorship/refund policies. Refund operations are documented separately in sponsorship.md.

## Actual sandbox validation

Tests used the real Roombai sandbox API and a local Cloudflare Pages runtime backed by local D1. No production database, production checkout, or live money was used.

| Check | Result |
| --- | --- |
| Browser selects left-4-1, uploads logo, accepts terms | Created hosted $9 USD Checkout Session |
| Stripe test card payment | Completed; `payment_status=paid`, `livemode=false` |
| Real `checkout.session.completed` event via Stripe CLI forwarding | Signed webhook accepted, HTTP 200 |
| Placement fulfillment | Logo available; local record has exactly 2,592,000 seconds (30 days) |
| Unsigned webhook | Rejected, HTTP 400 |
| Full sandbox refund | Succeeded; real `charge.refunded` webhook accepted, HTTP 200 |
| Refund visibility | Catalogue hides logo; image endpoint returns 404; management page shows removed |
| Replay of real paid-event payload, locally signed with test forwarding secret | Accepted idempotently; refunded placement remains hidden |
| Repeated checkout request | Same Checkout Session URL |
| Competing order for reserved square | Rejected, HTTP 409 |
| Real Stripe Checkout Session expiration | Webhook clears reservation |
| New session terms metadata | Version 2026-09-27 present |
| Responsive form at 390px and 1440px | 20 squares, no horizontal overflow |
| Unit suite | 19 tests passed, including delayed payments, renewals, signature/mode errors, reservation conflicts and counters |

Paid session: `cs_test_a1hMVliQGnhR7IQxxsYGKVvoBfiomvSol1YVx4o4CJGSl3rPleqcdrnHGW`.
Payment event: `evt_1UKTBWHanCCp0BgnSWJ7BswC`.
Refund: `re_3UKTBVHanCCp0Bgn0x0s74KQ`.
Expired session: `cs_test_a1wuxlXGx1ZUGVwj6zjGmehEi3359x6rknMWb19uZTAG4NynFoLeIVR1BZ`.

## Before live activation

1. Deploy to an isolated preview with its own sponsor database and test secrets to verify Cloudflare-hosted delivery. The current end-to-end test covers local forwarding, not a public production webhook.
2. Finish Stripe account activation and configure customer-facing Roombai branding, support email and published policy URLs. Decide tax treatment/registrations before enabling tax collection; automatic tax is currently off.
3. Provision a least-privilege restricted live API key, a live webhook endpoint and its separate signing secret in Cloudflare encrypted secrets. The local forwarding secret must not be reused for the deployed endpoint. Set the moderation secret as well.
4. Verify refund operations: partial/prorated refunds require operator suspension of the placement; only full-refund webhooks automatically hide it. Renewed placements need review of each affected purchase.
5. Update policy wording that currently says online checkout is not enabled. Preserve the approved pricing and refund terms.
6. Enable production sales only after an explicit live activation request. No live key or live activation was used during this review.

All credentials are in ignored local configuration or provider secret storage, never in this report. Automated renewal and delayed-payment edge cases were tested with controlled fixtures; no real delayed bank settlement was simulated in the browser.
