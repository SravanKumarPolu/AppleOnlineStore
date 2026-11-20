# System Architecture — NovaCart (AppleOnlineStore)

**Authority:** this document preserves the **application** baseline from 2026-10-26 (post Phase 2–4 stabilization). The dashed “proposed DevOps” boxes below are that day’s hand-off diagram.

**Infrastructure update (20 November 2026):** Dockerfiles, Compose, Kubernetes manifests, Terraform, and GitHub Actions are now in the repository. Read [DEPLOYMENT_ARCHITECTURE.md](./DEPLOYMENT_ARCHITECTURE.md) and [../06-DEPLOYMENT.md](../06-DEPLOYMENT.md) for the current deployment picture. Log aggregation and a live-cluster claim are still outside this page. The diagrams are kept so the 2026-10-26 baseline stays intact.

**Realtime update (20 November 2026):** the admin dashboard now also opens an authenticated Socket.IO connection and consumes order events. The storefront reconnect/room-resubscription flow and older diagrams below remain the 2026-10-26 baseline; see [DEPLOYMENT_ARCHITECTURE.md](./DEPLOYMENT_ARCHITECTURE.md) for the current client boundaries.

---

## 1. System context diagram

```mermaid
flowchart TB
    subgraph users["People"]
        SHOPPER["Shopper<br/>(customer)"]
        ADMINOP["Administrator<br/>(store operator)"]
        PAYPALOPS["PayPal<br/>(payment processor)"]
    end

    subgraph apps["Deployed Applications (current)"]
        STOREFRONT["Storefront React PWA<br/>frontend/ — React 18, Vite,<br/>@paypal/react-paypal-js,<br/>socket.io-client"]
        ADMINCONSOLE["React Admin Console<br/>admin/ — React 19, Vite,<br/>axios + fetch"]
        API["Express REST API + Socket.IO<br/>backend/ — Node >= 22, port 3001"]
    end

    subgraph data["Data Stores"]
        MONGO[("MongoDB<br/>database: e-commerce<br/>(default)")]
    end

    subgraph ext["External Services"]
        PAYPAL["PayPal API<br/>sandbox or live<br/>(single switch PAYPAL_ENV)"]
        CLOUD["Cloudinary<br/>image CDN"]
        SMTP["SMTP Email Provider<br/>(nodemailer)"]
    end

    SHOPPER -->|"HTTPS browser"| STOREFRONT
    ADMINOP -->|"HTTPS browser"| ADMINCONSOLE
    STOREFRONT -->|"REST /api/* (fetch, token header)"| API
    ADMINCONSOLE -->|"REST /api/* (token / Bearer)"| API
    ADMINCONSOLE <-->|"Socket.IO (websocket, JWT auth)"| API
    STOREFRONT <-->|"Socket.IO (websocket, JWT auth)"| API

    API --> MONGO
    API -->|"Orders API + verify-webhook-signature"| PAYPAL
    PAYPAL -->|"Webhook POST /api/orders/paypal/webhook"| API
    API -->|"image upload / destroy"| CLOUD
    API -->|"welcome + password-reset mail<br/>(non-blocking, optional)"| SMTP

    subgraph future["2026-10-26 hand-off box — containers and CI now exist; see DEPLOYMENT_ARCHITECTURE.md"]
        style future stroke-dasharray: 6 4,fill:#f5f5f5
        LB["Load balancer / TLS termination"]
        DOCKER["Docker images"]
        K8S["Kubernetes / AWS"]
        CI["CI/CD pipeline"]
    end
```

**Key facts verified from code**

- The storefront is a PWA (`vite-plugin-pwa`, service worker, offline page); the admin console is a plain SPA.
- The storefront and admin dashboard both hold authenticated Socket.IO connections. The admin connection and Orders-page event handling were added after the 2026-10-26 audit; its §3.1 finding is historical.
- PayPal sandbox/live selection is centralized in `config/paypalEnv.js` — the capture flow and the webhook verifier can never target different PayPal environments.
- MongoDB database selection: complete `MONGODB_URI` used verbatim; bare host URI gets `MONGODB_DB` (default `e-commerce`) appended by `config/mongodb.js`.

---

## 2. Application startup and readiness flow

```mermaid
flowchart TB
    START(["node server.js"]) --> GUARD["config/startupValidation.js<br/>validateRuntimeConfig()"]
    GUARD -->|"FATAL: live PayPal creds missing/placeholder,<br/>or NODE_ENV=production without JWT_SECRET"| EXIT1(["exit 1 — refuse to boot<br/>(before any resource is opened)"])
    GUARD -->|"warnings only (staging topologies)"| DB

    DB["config/mongodb.js connectDB()"] --> RESOLVE["resolveMongoConnectionUri()<br/>validate scheme, apply default db"]
    RESOLVE -->|"missing / malformed MONGODB_URI"| EXIT2(["throw — startup fails fast<br/>(redacted log, exit 1)"])
    RESOLVE --> CONNECT["mongoose.connect()"]
    CONNECT --> PING{"readyState == 1<br/>AND db.admin().ping()"}
    PING -->|"no"| EXIT2
    PING -->|"yes"| CLOUD["config/cloudinary.js<br/>SDK config (no network I/O)"]
    CLOUD --> SOCKET["socketService.initialize(server)<br/>JWT-auth handshake middleware"]
    SOCKET --> LISTEN["server.listen(0.0.0.0:PORT)"]
    LISTEN --> READY(["READY — log + health endpoints live"])

    READY --> LIVE["GET /health/live → 200<br/>(process liveness only)"]
    READY --> RDY["GET /health/ready → 200 iff<br/>mongoose readyState == 1<br/>AND not draining; else 503"]

    SIG(["SIGTERM / SIGINT"]) --> SM["utils/shutdownManager.js<br/>initiateShutdown()"]
    SM --> DRAIN["onDrain flag → non-health requests 503<br/>(readiness reports not-ready)"]
    DRAIN --> HTTPCLOSE["close HTTP server<br/>(budget-bounded; force-destroy<br/>keep-alive sockets on timeout)"]
    HTTPCLOSE --> SCLOSE["close Socket.IO"]
    SCLOSE --> DCLOSE["close MongoDB (no force)"]
    DCLOSE --> EXITOK{"cleanup complete<br/>within SHUTDOWN_TIMEOUT_MS?"}
    EXITOK -->|"yes"| EXIT0(["exit 0 — graceful"])
    EXITOK -->|"no — forced"| EXITF(["exit 1 + alert log<br/>(unclean shutdown surfaced)"])

    UR(["unhandledRejection"]) --> LOGR(["redacted log — process stays alive"])
    UC(["uncaughtException"]) --> EXITC(["redacted log — exit 1"])
```

**Verification:** `npm run verify:startup` (backend) executes this exact path against an in-memory MongoDB and asserts: ready 200, default database selected, graceful SIGTERM exit 0, no credentials in the startup log.

---

## 3. Logical architecture (2026-10-26 snapshot)

The solid boxes are the application. The dashed box was the DevOps hand-off on 2026-10-26. Container images, a registry publish path, Kubernetes manifests, and CI workflows have since been added; log aggregation is still not in the repo. Current deployment limits are in [DEPLOYMENT_ARCHITECTURE.md](./DEPLOYMENT_ARCHITECTURE.md). This diagram is preserved as the snapshot, not redrawn.

```mermaid
flowchart LR
    subgraph current["CURRENT — implemented"]
        CDN["(none today)<br/>static assets served by<br/>Netlify/Vite preview or local dev"]
        FE["frontend build (dist/)<br/>React 18 PWA"]
        AD["admin build (dist/)<br/>React 19 SPA"]
        BE["backend service<br/>Express + Socket.IO<br/>stateless except Socket.IO rooms"]
        DBX[("MongoDB<br/>e-commerce")]
        EXT["Cloudinary · PayPal · SMTP"]
    end

    FE --> BE
    AD --> BE
    BE --> DBX
    BE --> EXT

    subgraph proposed["2026-10-26 DevOps hand-off — deployment files have since landed; see DEPLOYMENT_ARCHITECTURE.md"]
        style proposed stroke-dasharray: 6 4
        direction TB
        TLSTERM["TLS termination / reverse proxy"]
        REG["Container registry + Docker images"]
        ORCH["Kubernetes on AWS<br/>(liveness: /health/live,<br/>readiness: /health/ready)"]
        CICD["CI/CD: lint, typecheck, tests,<br/>build, image publish, deploy"]
        SECRETS["Secrets manager<br/>(JWT_SECRET, PAYPAL_*, SMTP_*,<br/>MONGODB_URI, ADMIN_*)"]
        LOGS["Log aggregation + alerting<br/>(PAYMENT WEBHOOK ALERT lines)"]
        ATLAS["Managed MongoDB (e.g. Atlas)"]
    end

    TLSTERM -.-> FE
    TLSTERM -.-> AD
    TLSTERM -.-> BE
    CICD -.-> REG -.-> ORCH -.-> BE
    SECRETS -.-> BE
    ATLAS -.-> DBX
    LOGS -.-> BE
```

**DevOps-relevant properties of the current service (verified)**

| Property | Value / behavior |
|---|---|
| Runtime | Node.js >= 22 (engines field), ESM (`"type": "module"`) |
| Listen | `0.0.0.0:$PORT` (default 3001) |
| Probes | `/health/live` (liveness), `/health/ready` (readiness, DB-aware), legacy `/health` |
| Shutdown | Drain flag → 503; bounded http → sockets → db close; exit code signals cleanliness |
| Config | Environment variables only (see `backend/.env.example`); fatal boot guardrails for live-payments and production-auth misconfiguration |
| State | Process is stateless; Socket.IO rooms re-form on reconnect; webhookevents collection provides cross-restart idempotency |
| Scaling note | Socket.IO is in-memory (no Redis adapter) — sticky sessions or an adapter will be required for multi-replica deployments (see `DEVOPS_BASELINE.md`) |
| Build | Backend: no build; frontend/admin: `tsc -b && vite build` |

---

## 4. Socket.IO order update flow (diagram 8 of the corrected set)

```mermaid
sequenceDiagram
    participant Client as Storefront (useWebSocket)
    participant SIO as Socket.IO Server (socketService)
    participant Auth as JWT handshake middleware
    participant Ctl as Order/Payment controllers
    participant Rooms as Rooms

    Client->>SIO: io(backendUrl, { auth: { token } })
    SIO->>Auth: verify JWT
    alt admin token (type=admin)
        Auth->>Rooms: socket.join('admin_room')<br/>userId = null
    else shopper token
        Auth->>Rooms: socket.join('user_<id>')<br/>after userModel lookup (isActive)
    end
    Auth-->>Client: connection established<br/>(transports: websocket, polling)

    Client->>SIO: join_order_room(orderId)
    SIO->>Rooms: join order_<orderId>

    Note over Ctl: Order lifecycle events
    Ctl->>SIO: sendNewOrderToAdmin(order)         (POST /api/orders)
    SIO->>Rooms: emit 'new_order' to admin_room
    Ctl->>SIO: sendOrderUpdateToUser(userId, order)
    SIO->>Client: emit 'order_updated' (direct socket id)
    Ctl->>SIO: sendPaymentStatusUpdate(order)      (PayPal capture OK)
    SIO->>Client: emit 'order_updated' type=payment_update
    SIO->>Rooms: emit to admin_room
    Ctl->>SIO: sendOrderStatusUpdate(order)        (admin PUT /api/orders/status)
    SIO->>Client: emit 'order_updated' + order room + admin room

    Note over SIO: Null-safe helpers — emits are skipped<br/>(debug log) when the socket layer is not initialized.
    Note over SIO: close() used by graceful shutdown.
```

**Verified behaviors:** admin room joins are role-gated server-side; all emit helpers tolerate an uninitialized/closed socket layer so order flows never crash on realtime failures; the connected-users map backs `GET /api/socket/status`.
