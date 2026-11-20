# NovaCart architecture diagrams

These Mermaid diagrams are rendered by GitHub. They describe the repository's
implemented application and committed deployment configuration; they do not
prove that a cloud environment is currently running.

## Start here

| Diagram or reference | What it covers |
| --- | --- |
| [System architecture](./SYSTEM_ARCHITECTURE.md) | Application context, startup/readiness, and realtime event flow |
| [Deployment architecture](./DEPLOYMENT_ARCHITECTURE.md) | Committed AWS/EKS layout, CI image publishing, and deployment boundaries |
| [Component diagram](./COMPONENT_DIAGRAM.md) | Frontend, backend middleware, routes, controllers, models, and integrations |
| [Authentication flow](./AUTH_FLOW.md) | Shopper/admin authentication and authorization boundaries |
| [Checkout and payment flow](./CHECKOUT_PAYMENT_FLOW.md) | Order creation, stock reservation, PayPal capture, and webhook reconciliation |
| [Database relationships](./DATABASE_RELATIONSHIPS.md) | MongoDB collections, embedded data, references, and integrity rules |
| [DevOps baseline](./DEVOPS_BASELINE.md) | Infrastructure and operational baseline |
| [Architecture audit](./ARCHITECTURE_AUDIT.md) | Code-to-diagram audit and dated findings |
| [Checkout reliability case study](../case-studies/CHECKOUT_RELIABILITY.md) | Design decisions behind recoverable checkout and payment processing |

## Reading notes

- The application diagrams are detailed snapshots, and some retain their
  original audit dates. The deployment diagram is the newer view of committed
  infrastructure. Read the date and scope note at the top of each document.
- For capability status, the authoritative feature catalog is
  [the PRD](../01-PRD.md); for current operational behavior, see
  [operations](../09-OPERATIONS.md) and
  [deployment](../06-DEPLOYMENT.md).
- PayPal integration tests use mocks. A live signed PayPal sandbox round trip
  remains **UNVERIFIED** until the documented validation checklist is run.
