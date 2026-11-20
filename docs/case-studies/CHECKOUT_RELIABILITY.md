# Technical case study: making checkout recoverable

NovaCart's checkout crosses three independently changing systems: the
storefront, the backend, and MongoDB. PayPal adds an asynchronous webhook
delivery path. The design has to preserve order, payment, and stock integrity
when requests race, a process stops partway through checkout, or a webhook
arrives before the capture request finishes.

This case study describes the implemented flow, not a claim that external
payment or cloud environments have been exercised live.

## The engineering problem

A checkout must not trust a browser for identity, price, or payment status.
It must also avoid overselling when orders compete for the last units. A
simple "decrement stock, then save the order" sequence has a crash window:
the process can stop after the decrement, leaving no order document to explain
or recover the lost stock.

Payment introduces a second ordering problem. The PayPal capture response and
its signed webhook can race or be retried, and either path must not apply a
payment twice or overwrite a refunded order.

## Design and flow

1. **Establish authority on the server.** Shopper identity comes from the
   verified token. Product names, images, and prices are read from MongoDB;
   totals are computed server-side. The client cannot choose a lower price.
2. **Persist the recovery record first.** Checkout creates an order draft with
   a pending stock-reservation state before changing product stock. Each
   per-item decrement is an atomic conditional update that both checks
   available quantity and writes a reservation marker keyed by order and item.
   The order is committed as reserved only after the item reservations
   succeed.
3. **Make retries and recovery explicit.** The generic order endpoint accepts
   an optional per-user `Idempotency-Key`; a unique partial index arbitrates
   concurrent duplicate submissions. A reservation sweep handles abandoned
   drafts and expired PayPal holds. A failed stock credit remains an explicit
   reconciliation obligation rather than being silently discarded.
4. **Prove stock restoration atomically.** On cancellation, expiry, or a
   completed refund, the product-side update increments stock and records its
   restoration credit in the same atomic operation. A retry sees the marker
   and cannot credit the same order line twice.
5. **Keep PayPal separate from generic orders.** The PayPal create endpoint
   stores the PayPal order id needed for reconciliation. The capture endpoint
   checks ownership, completion state, and captured amount/currency against
   the stored order. A Card order is only a pending record; it does not call a
   card gateway.
6. **Treat webhooks as untrusted until verified.** The backend preserves the
   raw request body, verifies the PayPal signature before database writes,
   then atomically acquires the event in a collection with a unique event-id
   index. Recoverable states allow failed, interrupted, and unmatched events
   to be retried safely. Terminal mismatches are surfaced for operator review.

The sequence and webhook state-machine diagrams are in
[Checkout and payment flow](../architecture/CHECKOUT_PAYMENT_FLOW.md); the
related collection structure and stock-ledger rules are in
[Database relationships](../architecture/DATABASE_RELATIONSHIPS.md).

## Reliability properties

- **No oversell from competing reservations:** each stock debit is conditional
  on sufficient quantity and atomic at the product document.
- **Recoverable partial work:** a persisted draft and per-line reservation
  markers give the sweep enough information to settle interrupted attempts.
- **At-most-once stock movement:** reservation and restoration markers make
  retries and racing workers idempotent.
- **Payment state is evidence-based:** a request being sent is not equivalent
  to a completed capture or refund. Amount, currency, identity, and terminal
  order state are checked before mutation.
- **Realtime is notification, not the source of truth:** order updates are
  emitted through Socket.IO, while persisted order state remains authoritative.

## Verification and limits

The backend regression suite includes focused coverage for checkout
idempotency, inventory pricing and reservation, reservation expiry and
restoration, PayPal capture verification, webhook idempotency, and unmatched
capture recovery. The latest recorded backend gate in
[the testing plan](../07-TESTING_PLAN.md) is 47 suites / 534 tests passing on
2026-11-04; that record is not a test run performed for this case study.

The PayPal network edge is mocked in automated tests. A signed sandbox
approval, capture, and webhook round trip remains **UNVERIFIED** pending the
[sandbox validation checklist](../devops/08-PAYPAL-SANDBOX-VALIDATION-CHECKLIST.md).
The committed AWS backend manifests use one replica and do not deploy Redis;
cross-pod Socket.IO delivery is therefore not claimed. See
[deployment architecture](../architecture/DEPLOYMENT_ARCHITECTURE.md) for
the repository's infrastructure boundaries.
