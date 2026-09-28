# Website sponsorships

The website sells a single named position on one of two ten-square walls. Prices in USD are $49, $29, $19, and $9 for rows 1–4. Each payment buys 30 days. There are no subscriptions or automatic renewals. Desktop rails and the mobile sponsor section share the same inventory.

## Architecture

- `site/server/sponsors.js`: Pages Functions backend, Stripe Checkout and verified webhooks.
- `site/sponsor-migrations/0001_sponsors.sql`: D1 inventory, orders, small PNG logos, and checkout rate limits.
- `site/sponsor/`: pixel-styled selection, preview, checkout, status, and renewal UI.
- `site/sponsors.js`: live website placements, refreshed every minute while the page is visible.
- `site/test/sponsors.test.js`: tests using the production SQL in SQLite and mocked Stripe responses, plus real SDK webhook signature verification.

Stripe dependencies and tooling live in `site/package.json`, separate from the Electron app. Website changes do not trigger desktop release builds. Server source, dependencies, tests, configs, and secrets are excluded from static assets.

## Local development

From the repository root:

```sh
npm ci --prefix site
npm run build:site
cd site
node node_modules/wrangler/bin/wrangler.js d1 migrations apply roombai-sponsors --local
npm run dev
```

Local Wrangler uses a separate SQLite database. The public catalogue and preview work without Stripe. For payment testing, use a separate Stripe sandbox and an ignored `site/.dev.vars` file containing `STRIPE_RESTRICTED_KEY`, `STRIPE_WEBHOOK_SECRET`, `SITE_ORIGIN=http://localhost:8788`, `SPONSORS_ENABLED=true`, and `STRIPE_LIVE_MODE=false`. Match the origin to the port Wrangler prints. Never commit credentials.

Forward Stripe sandbox events to `/api/sponsors/webhook` with `stripe listen --forward-to http://localhost:8788/api/sponsors/webhook`, using its signing secret in `.dev.vars`. Exercise an actual sandbox checkout with a test card before enabling live sales; unit tests do not prove account permissions, payment configuration, or live delivery.

```sh
npm test
```

## Production activation

The D1 database is `roombai-sponsors`; its initial schema has been provisioned, but the sponsorship code is not deployed. `site/wrangler.jsonc` will bind it as `SPONSORS_DB` when deployed. Future migrations must be applied before deploying code that requires them. `site/wrangler.jsonc` is the binding and non-secret configuration source of truth.

When deployment is authorized, set the Pages build command to `npm test && node ../scripts/build-site.js && node ../scripts/build-downloads.js`, keeping root `site` and output `.output`. This runs the website tests before every website deployment.

1. Select the intended Stripe account. Create a restricted API key for this service with permission to create/retrieve Checkout Sessions and their required dependencies. Do not use an account-wide key by default.
2. Store it in Pages encrypted secrets. Run from `site/`; each command prompts for the value, so it does not appear in shell history:

   ```sh
   node node_modules/wrangler/bin/wrangler.js pages secret put STRIPE_RESTRICTED_KEY --project-name roombai
   node node_modules/wrangler/bin/wrangler.js pages secret put STRIPE_WEBHOOK_SECRET --project-name roombai
   ```

3. Create a Stripe webhook endpoint at `https://roombai.com/api/sponsors/webhook`, API version `2026-08-26.dahlia`, with these events:

   - `checkout.session.completed`
   - `checkout.session.async_payment_succeeded`
   - `checkout.session.async_payment_failed`
   - `checkout.session.expired`
   - `charge.refunded`
   - `charge.dispute.created`

   Store that endpoint's signing secret using the command above. A CLI-forwarding signing secret is not the deployed endpoint's secret.
4. Verify the full flow in an isolated sandbox deployment/database first: successful payment, canceled checkout, replayed webhook, delayed payment, expiry, renewal, and refund.
5. For production, set `STRIPE_LIVE_MODE` to `true` and `SPONSORS_ENABLED` to `true` in `site/wrangler.jsonc`, with the live account key and live webhook secret installed. Redeploy Pages. Leave both false until setup is complete. No desktop release is needed.

Checkout is one-time `mode=payment`; its price comes exclusively from server code. Logo/name/website are collected before checkout. Payment details stay on Stripe. Payment methods follow Stripe Dashboard configuration. Automatic tax is not enabled; any tax configuration must be decided and verified separately before enabling it.

## Reservations and fulfillment

D1 atomically claims a slot before creating a Checkout Session. The same random order ID becomes Stripe's idempotency key. Checkout lasts 35 minutes. A slot is never resold solely because a local timer elapsed: the backend first reconciles with Stripe, protecting delayed webhook delivery and asynchronous payments. Completed-but-unpaid sessions hold inventory until success or failure. Unknown network outcomes keep their reservation and retry with the same idempotency key. If Stripe is unreachable, the backend preserves inventory rather than risk selling a paid slot twice.

Fulfillment checks the signature, environment, order/session identity, currency, and exact amount. Only paid sessions become active; the first successful fulfillment sets the term. Replays cannot extend it. Renewal adds 30 days to the later of now or the old expiry. Full refunds and disputes hide the associated placement. A refund after a subsequent renewal requires operator review of that renewed placement.

Expired placements are omitted by timestamp on every catalogue/logo request. No scheduled job is required to hide them. Catalogue requests also reconcile expired checkout reservations. The website refreshes once a minute, so a tab already open may take up to a minute to reflect a change.

## Sponsor management and moderation

Sponsors return to a status page after Checkout. Their browser retains a random management token; the server stores only its SHA-256 hash. The **Copy private link** control includes the token in a URL fragment, which is not sent in HTTP requests. There is no analytics script on this page, and referrers are suppressed. Losing both browser storage and the saved link requires operator help through @joeldev_. Email recovery is not implemented.

To enable the moderation endpoint, generate a cryptographically random 32-byte hex token and save it as the Pages encrypted secret `SPONSOR_ADMIN_TOKEN`. Send `POST /api/sponsors/admin/remove` with `Authorization: Bearer <token>` and JSON `{"slot":"left-1-1"}`. This immediately hides existing orders for that slot, including pending ones; it does not issue a refund. Use Stripe Dashboard to handle refunds and disputes. Until the admin secret is provisioned, the endpoint rejects every request. The owner can also suspend an order directly through the Cloudflare D1 console.

Logos are resized into small PNGs before upload, validated again server-side, and served as images with `nosniff`. Input text is rendered with DOM text nodes. Sponsor links use `rel="sponsored noopener noreferrer"`. Public APIs never expose tokens, token hashes, checkout sessions, or payment identifiers.

## Published policies and refund operations

Privacy and terms are published at https://roombai.com/privacy/ and https://roombai.com/terms/. Nottifai LLC is the operator; support is support@nottifai.com. The checkout checkbox links to both policies.

The approved refund policy gives a full refund before a placement starts, then a prorated refund of unused time on cancellation or failed delivery. Refunds are handled by the operator, not automatically requested by the buyer through the app. Record the request time, verify the order, calculate the unused fraction of the purchased 30-day term, suspend the placement with the moderation endpoint, and issue the appropriate refund in Stripe Dashboard. Partial refunds do not automatically hide a placement, so the suspension step is required. Keep the request and refund reference with the transaction records. A renewed placement needs review of each affected purchase.

The published terms already describe online checkout. Before enabling live checkout, verify tax handling and account activation, and complete a real sandbox checkout and webhook-delivery test; passing the mocked API tests alone is not activation evidence.

## Monitoring

Watch the Pages Functions logs for `sponsor-paid-unplaced`. It means Stripe took a payment that did not publish a square: the order was removed by moderation before payment finished, or the checkout did not match its reservation. Refund those payments manually. Webhook deliveries for these cases return 200, so Stripe does not keep retrying. Expired holds are checked against Stripe at most once a minute, triggered by visitors loading the public catalog. `sponsor-reconciliation` errors that keep repeating usually mean an order is waiting for operator review.
