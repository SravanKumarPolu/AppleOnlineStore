# NovaCart — Deployment Guide

> **Status:** repository-grounded on **20 November 2026**. This guide replaces the 2026-10-24 text that said the repository had no Dockerfile, Compose file, GitHub Actions workflow, or Terraform. Those artifacts are in the tree now.
>
> A committed manifest is configuration. It is not proof that `novacart-dev-eks` is running, that `novakart.xyz` answers, or that a workflow succeeded on its last attempt.
>
> **Chain:** [05-API_REFERENCE.md](./05-API_REFERENCE.md) → **this file** → [07-TESTING_PLAN.md](./07-TESTING_PLAN.md). Diagrams: [architecture/DEPLOYMENT_ARCHITECTURE.md](./architecture/DEPLOYMENT_ARCHITECTURE.md).

## Deployment surfaces

| Surface | In repository | What it actually does |
| --- | --- | --- |
| Local development | `backend/`, `frontend/`, `admin/` | Three Node/Vite processes plus MongoDB and the external services you configure |
| Docker Compose | `compose.yaml`, three Dockerfiles | Prebuilt local tags, loopback ports, backend health gate |
| Local Kubernetes | `k8s/*.yaml` | Deployments, Services, backend HPA, Redis, local Gateway HTTPRoutes |
| AWS EKS configuration | `k8s/aws/*.yaml`, `terraform/` | Namespace, three apps, ALB Ingress, VPC/IAM/ECR/EKS source |
| CI, scan, and image publish | `.github/workflows/novacart-ci-cd.yml` | Lint, test, build, Trivy. GHCR for three images and ECR for the backend on a `main` push |
| Backend EKS rollout | `.github/workflows/novacart-eks-deploy.yml` | **Manual** `workflow_dispatch` of one backend image SHA |

## 1. Development

| Dependency | Purpose |
| --- | --- |
| Node.js ≥ 22 | Backend runtime (`engines`). CI and Dockerfiles use Node 24 |
| MongoDB | Primary datastore. Atlas or local |
| PayPal app | Sandbox or live. Client id, secret, webhook id |
| Cloudinary | Product images (`CLOUDINARY_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_SECRET_KEY`) |
| SMTP | Transactional email. Optional for boot; required for real mail |

```bash
# Each app in its own terminal, after copying .env.example to .env
(cd backend && npm ci && npm run dev)
(cd frontend && npm ci && npm run dev)
(cd admin && npm ci && npm run dev)
```

Production static hosting is still valid: `npm run build` writes `frontend/dist` and `admin/dist` (SPA fallback to `index.html`). The container path below is the one the repository now automates.

CORS is environment-driven in production (`FRONTEND_URL`, `ADMIN_URL`, `CORS_EXTRA_ORIGINS`). Development also allows `http://localhost:3000`, `:5173`, and `:5174`. The old hardcoded Netlify origins are gone. Compose sets `CORS_EXTRA_ORIGINS` to the loopback storefront and admin origins.

Process supervision is still your job outside Compose and Kubernetes. The process exits 1 on fatal configuration by design. MongoDB backups are not implemented in this repo.

## 2. Docker Compose

`compose.yaml` names images. It does not build them.

```bash
docker build -t novacart-backend:v2 ./backend

# Public client id only. Leave VITE_BACKEND_URL unset so the bundle stays
# same-origin and Nginx proxies /api and /socket.io to the backend service.
docker build -t novacart-frontend:v3 \
  --build-arg VITE_PAYPAL_CLIENT_ID=your-public-paypal-client-id \
  ./frontend

docker build -t novacart-admin:v2 ./admin

docker compose up -d
docker compose ps
docker compose down
```

| Service | Image tag in Compose | Host binding |
| --- | --- | --- |
| backend | `novacart-backend:v2` | `127.0.0.1:3001` |
| frontend | `novacart-frontend:v3` | `127.0.0.1:8080` |
| admin | `novacart-admin:v2` | `127.0.0.1:8081` → container `8080` |

The backend service reads `backend/.env`. Storefront and admin start only after the backend health check against `http://127.0.0.1:3001/health/ready` succeeds. Frontend and admin images are unprivileged Nginx on port 8080 and proxy `/api/` and `/socket.io/` to `http://backend:3001`. Both browser apps use authenticated Socket.IO connections: the storefront restores order-room subscriptions after reconnect, while the admin provider reconnects and the Orders page consumes `new_order` and `order_updated` events.

Local Kubernetes manifests use different tags (`novacart-backend:v4`, `novacart-frontend:v4`, `novacart-admin:v2`). Build or retag to the tag the manifest you are applying expects.

## 3. Local Kubernetes

Manifests under `k8s/` (not `k8s/aws/`) are the local set:

- Deployments and Services for frontend, admin, and backend. The backend Deployment omits `replicas` (Kubernetes default is 1). Frontend and admin set `replicas: 1`.
- `k8s/backend-hpa.yaml` targets `novacart-backend` at 1–3 replicas and 70% CPU. Applying the HPA is a separate step. The file does not by itself enable autoscaling.
- `k8s/redis-deployment.yaml` and `k8s/redis-service.yaml` are a single-replica, no-auth, ephemeral Redis for local Socket.IO fan-out. Keep them ClusterIP-only. See §12.
- `k8s/novacart-httproutes.yaml` routes `shop.novacart.localhost` to the storefront and `admin.novacart.localhost` to admin, via a Gateway named `traefik-gateway`. Those hostnames are local. They are not `admin.novakart.xyz`.

Cluster install (kind or otherwise) is outside these files. Probes on the local backend Deployment are `/health/live` and `/health/ready`.

## 4. Tests before a deploy

```bash
(cd backend && npm ci && npm run lint && npm test && npm run build)
(cd frontend && npm ci && npm run lint && npm test -- --run && npm run build)
(cd admin && npm ci && npm run lint && npm test -- --run && npm run build)
```

Browser checks: `(cd frontend && npm run test:e2e)`. The first run downloads Playwright browsers. This documentation pass did not execute these commands.

Latest counts written down elsewhere, with their dates, are in the root [`README.md`](../README.md). `docs/testing/` reports match the day they were produced.

`cd backend && npm run test:smoke` is a live MongoDB/SMTP smoke runner. It is not the gate.

## 5. AWS configuration that is in git

Terraform under `terraform/` defines a VPC with public subnets, security groups, IAM, three ECR repositories (`novacart/backend`, `novacart/frontend`, `novacart/admin`, immutable tags, scan on push), and an EKS cluster resource named `novacart-dev-eks` in the source (`version = "1.37"` in `terraform/eks-cluster.tf`). The cluster API is configured for public and private access, limited by `var.eks_admin_cidrs`, on the two public subnets. `terraform/ecr.tf` still opens with “Configuration only — do not apply yet.”

`k8s/aws/` contains:

- Namespace `novacart`.
- Deployments `novacart-frontend`, `novacart-admin`, `novacart-backend`, each `replicas: 1`, with CPU and memory limits.
- ClusterIP Services `frontend` and `admin` on port 8080, and `backend` on port 3001.
- A backend ConfigMap (`FRONTEND_URL=https://novakart.xyz`, `CORS_EXTRA_ORIGINS` includes `https://www.novakart.xyz`) and a Secret **name** `novacart-backend-env`. Secret values are not in git.
- Ingress `novacart-public` (`ingressClassName: alb`) for hosts `novakart.xyz` and `www.novakart.xyz`.

Ingress paths, both hosts:

| Path | Service |
| --- | --- |
| `/api` | `backend:3001` |
| `/socket.io` | `backend:3001` |
| `/` | `frontend:8080` |

There is no host rule for `admin.novakart.xyz`. The admin Service is ClusterIP. The owner reports using the dashboard locally, not through a public admin domain, and reports this Kubernetes port-forward as a previously verified access method:

```bash
kubectl --context novacart-aws \
  -n novacart port-forward deployment/novacart-admin 8081:8080
# http://127.0.0.1:8081
```

This tunnels the admin Deployment to localhost; it does not create DNS or a certificate. The prior verification is owner-reported and the current cluster state was not rechecked for this update.

The Ingress is annotated for the AWS Load Balancer Controller (internet-facing, TLS redirect, a certificate ARN, two subnet ids). The ALB is not a `aws_lb` resource in Terraform. Account ids, subnet ids, and certificate ARNs live in the manifests; copy them from those files when you operate the account, and do not publish new copies into unrelated docs.

Read-only checks **if** you already have credentials and a cluster. They were not run for this documentation update:

```bash
aws sts get-caller-identity
aws eks describe-cluster --name novacart-dev-eks --region us-east-1 --query 'cluster.status'
kubectl -n novacart get deploy,svc,ingress
kubectl -n novacart rollout status deployment/novacart-backend
```

Apply steps are omitted on purpose. The tree contains environment-specific IAM, CIDRs, image tags, and certificate references that need an owner review first.

### CI/CD boundaries

| Workflow | Trigger | Effect |
| --- | --- | --- |
| `novacart-ci-cd.yml` | Pull request to `main`, push to `main`, or manual | Lint, unit test, and build all three apps. Build three images and fail on unfixed Trivy HIGH/CRITICAL findings. On a **push to `main`**, push all three images to GHCR and the backend image to ECR |
| `novacart-eks-deploy.yml` | Manual, and only when the ref is `main` | Self-hosted runner labels `self-hosted`, `macOS`, `X64`, `novacart-eks-deploy`. Assumes role `novacart-github-eks-deploy`, updates kubeconfig for `novacart-dev-eks`, runs `scripts/deploy-eks-backend.sh` for the `novacart-backend` Deployment. Rollback runs only when the script decides the previous image is safe to restore |
| `novacart-eks-auth.yml` | Manual, on `main` | Assumes the EKS deploy role and checks identity. No rollout |
| `aws-oidc-test.yml` | Manual | Assumes `novacart-github-deploy` and prints the caller identity. No rollout |
| `novacart-worker-tests.yml` | Pull request or push to `main`, or manual | `bash -n` and Python unit tests for `scripts/aws/` worker lifecycle scripts. No image publish and no rollout |

Pull requests build and scan images. They do not push them. Frontend and admin ECR repositories exist in Terraform, and `k8s/aws` pins frontend and admin ECR tags, but `novacart-ci-cd.yml` pushes only the backend image to ECR.

It is inaccurate to say all three applications deploy to EKS on every push.

### Latest observed CI run

[Run 44732558120, attempt 2](https://github.com/SravanKumarPolu/AppleOnlineStore/actions/runs/44732558120/attempts/2) was a pull-request run on 20 November 2026 for commit `483a25e`. The screenshot supplied with this update shows the first attempt; attempt 2 still failed the frontend and admin scans with the same findings. The overall run failed:

| Job | Result | Log evidence |
| --- | --- | --- |
| Verify backend, frontend, admin | Passed | All three verification jobs completed successfully |
| Build and scan backend | Passed | Docker build and Trivy scan completed successfully |
| Build and scan frontend | Failed | Docker build passed; the `Scan image with Trivy` step failed |
| Build and scan admin | Failed | Docker build passed; the `Scan image with Trivy` step failed |
| GHCR/ECR publishing | Skipped | Publishing steps are conditional on a push to `main`; this run was a pull request |

Both failed Trivy steps scanned Alpine 3.24.2 images and reported six `nginx` OS-package vulnerabilities: four CRITICAL (`CVE-2026-113425`, `CVE-2026-121810`, `CVE-2026-123007`, `CVE-2026-123633`) and two HIGH (`CVE-2026-118899`, `CVE-2026-123634`). The installed package was `nginx 1.30.6-r1`; Trivy listed `1.30.7-r0` as fixed. The log also warns that Alpine 3.24 is not on Trivy's EOL list; that warning was not the step's failure cause. With `exit-code: '1'`, `severity: CRITICAL,HIGH`, and `ignore-unfixed: true`, these findings caused both scans to exit 1.

The failure was in vulnerability scanning, not Docker image construction, registry publishing, AWS authentication, or permissions. GHCR/ECR publishing was not attempted in this pull-request run.

#### Dockerfile remediation and local validation

The previous `nginxinc/nginx-unprivileged:stable-alpine` image pinned NGINX and its bundled modules to exact package versions. Its existing `apk upgrade --no-cache` updated other Alpine packages but could not replace the pinned NGINX package with `1.30.7-r0`. The versioned `stable-alpine3.24` tag resolved to the same image digest and package versions during verification; the Debian-based `stable` tag also contained NGINX `1.30.6`. The frontend and admin Dockerfiles now use the maintained `nginxinc/nginx-unprivileged:mainline-alpine3.24` tag instead. The tested image was Alpine 3.24 with NGINX and its modules at `1.31.7-r1`, above the reported fixed version. The existing NGINX configuration, app build stages, port 8080, and unprivileged UID 101 were retained. The trade-off is moving from NGINX's stable stream to its mainline stream; no configuration incompatibility was observed in the local checks below.

On 20 November 2026, both images were rebuilt with `--pull --no-cache`. Trivy 0.70.0, using the workflow's OS/library vulnerability scanner and HIGH/CRITICAL failure policy, found zero vulnerabilities in either image. A separate all-severity scan without `ignore-unfixed` also returned zero, so no fixed or unfixed vulnerability findings were reported. Frontend tests passed (26 files / 170 tests), and admin tests passed (15 files / 85 tests). Both containers started as UID 101, passed `nginx -t`, and returned HTTP 200 for `/`.

The Alpine 3.24 EOL-list warning remains. No scan policy or workflow was changed. These are local results only: GitHub Actions has not yet rerun on the Dockerfile changes, so the latest remote run above remains failed until a new run verifies them.

## 6. PayPal

1. `PAYPAL_ENV` is the only live/sandbox switch (`backend/config/paypalEnv.js`). `live` is the only value that selects live. Capture and webhook verification share it.
2. `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET` must belong to that same environment. Placeholder credentials with `PAYPAL_ENV=live` make the process exit 1 at boot.
3. Create the webhook in the same PayPal environment. Subscribe at least to `PAYMENT.CAPTURE.COMPLETED`, point it at `https://<backend-host>/api/orders/paypal/webhook`, and set `PAYPAL_WEBHOOK_ID`. Without that id the endpoint fails closed.
4. The storefront reads `VITE_PAYPAL_CLIENT_ID`. An empty value renders “PayPal payments are unavailable”. There is no hardcoded sandbox client id fallback (K-2, fixed 2026-10-25). Set the public client id at image build time for the container, or in `frontend/.env` for Vite dev.
5. Before calling live PayPal proven, run [devops/08-PAYPAL-SANDBOX-VALIDATION-CHECKLIST.md](./devops/08-PAYPAL-SANDBOX-VALIDATION-CHECKLIST.md). Local fail-closed checks have passed in earlier gate reports. A real signed sandbox round trip is still **UNVERIFIED**.

## 7. Environment variables

Authoritative names are `backend/.env.example`, `frontend/.env.example`, and `admin/.env.example`. The backend template matches the variables the process reads (46 names, including optional Redis and realtime knobs). Frontend reads `VITE_BACKEND_URL` and `VITE_PAYPAL_CLIENT_ID`. Admin reads `VITE_BACKEND_URL` (dev fallback `http://localhost:3001`).

| Variable | Meaning | Guardrail |
| --- | --- | --- |
| `NODE_ENV` | `production` or anything else | production without `JWT_SECRET` exits 1 |
| `PORT` | Listen port | default in code; containers set 3001 |
| `MONGODB_URI` | Connection string | never logged in full |
| `MONGODB_DB` | Database name when the URI has no path | optional, default `e-commerce` |
| `JWT_SECRET` | JWT signing secret | required in production |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Operator login | missing admin credentials warn at boot; login then fails |
| `PAYPAL_ENV` | `live` or `sandbox` | the single switch |
| `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET` | PayPal app credentials | fatal if placeholder while `live` |
| `PAYPAL_WEBHOOK_ID` | Webhook to verify | webhook fails closed without it |
| `PAYPAL_PAYEE_EMAIL` | Optional payee pin | unset uses the credential owner |
| `PAYPAL_RESERVATION_TTL_MS` | Unpaid PayPal hold TTL | default 1800000 |
| `RESERVATION_SWEEP_INTERVAL_MS` | Expiry and reconciliation sweep | default 300000 |
| `WEBHOOK_PROCESSING_LOCK_MS` | In-flight lock window | default 30000 |
| `WEBHOOK_MAX_UNMATCHED_ATTEMPTS` | Unmatched-event retry budget | default 10 |
| `SHUTDOWN_TIMEOUT_MS` | Graceful shutdown budget | default 10000 |
| `FRONTEND_URL` / `ADMIN_URL` | CORS allowlist entries | |
| `CORS_EXTRA_ORIGINS` | Comma-separated extra origins | optional |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_SECURE` | Email transport | |
| `SMTP_ALLOW_SELF_SIGNED` | Accept self-signed SMTP TLS | default reject |
| `EMAIL_FROM` / `EMAIL_FROM_NAME` | Sender identity | |
| `APP_NAME` | PayPal brand name and email branding | set it; email fallback in code is the legacy string `E-commerce Store`, PayPal brand fallback is `NovaCart` |
| `CLOUDINARY_NAME` / `CLOUDINARY_API_KEY` / `CLOUDINARY_SECRET_KEY` | Image hosting | names are not `CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_SECRET` |
| `ENABLE_DEBUG_ENDPOINTS` | Debug routes in production | default off (404) |
| `RATE_LIMIT_MAX` | Per-IP requests / 15 min | default 1000; do not raise it on a real deployment to green a suite |
| `AUTH_RATE_LIMIT_MAX` | `/api/user/*` requests / 15 min / IP | default 20 |
| `REDIS_URL` / `REDIS_HOST` / `REDIS_PORT` / `REDIS_PASSWORD` / `REDIS_DB` / `REDIS_TLS` | Socket.IO Redis adapter | unset = in-process adapter, one replica only |
| `SOCKETIO_REDIS_REQUIRED` | Refuse boot when configured Redis is down | default true in production |
| `SOCKETIO_REDIS_CONNECT_TIMEOUT_MS` | Redis connect budget at boot | default 10000 |
| `SOCKETIO_REDIS_KEY` | Adapter pub/sub prefix | default `socket.io`; identical on every replica |
| `SOCKETIO_TRANSPORTS` | `websocket,polling` or `websocket` | polling across replicas needs session affinity |
| `SOCKET_REVALIDATE_INTERVAL_MS` | Live-socket revalidation interval | default 60000 |

Startup guardrails (fatal versus warning) are summarized in [02-APP_FLOWS.md](./02-APP_FLOWS.md). Values are not printed.

Rotating `ADMIN_PASSWORD` alone does not revoke admin JWTs. `authAdmin` trusts a token signed with the current `JWT_SECRET` until it expires. Rotate `JWT_SECRET` in the same window when the goal is to invalidate sessions.

## 8. Health and shutdown

- `GET /health/live` — liveness. 200 while the process is up.
- `GET /health/ready` — readiness. 503 when the database is down or the process is draining.
- `SIGTERM` / `SIGINT` drain, then tear down within `SHUTDOWN_TIMEOUT_MS`. Clean exit is 0. Details: [09-OPERATIONS.md](./09-OPERATIONS.md).

Compose uses `/health/ready` as the backend health check. Kubernetes backend probes use `/health/live` for startup and liveness and `/health/ready` for readiness. `stop_grace_period` in Compose is 30s, which covers the default 10s shutdown budget.

`GET /health/ready` reports `checks.realtime: redis` when the multi-replica adapter is up. `degraded` means Redis was requested and is not usable, so cross-pod Socket.IO delivery is down.

## 9. Gates that are still owner work

| Gate | Status in the written record |
| --- | --- |
| `JWT_SECRET` and admin password rotation | Recorded as rotated and checked on 2026-10-24 ([devops/09-GO-LIVE-GATES-EXECUTION.md](./devops/09-GO-LIVE-GATES-EXECUTION.md)) |
| PayPal, MongoDB, Cloudinary, and SMTP credential rotation | Owner dashboard work. Runbook: [devops/07-CREDENTIAL-ROTATION-RUNBOOK.md](./devops/07-CREDENTIAL-ROTATION-RUNBOOK.md) |
| Git history and dangling-object hygiene | Follow the security scripts in `AGENTS.md`. Do not mark a purge complete from this guide |
| PayPal sandbox end-to-end | **UNVERIFIED** for the real signed webhook items |
| Live AWS account | **UNVERIFIED** from static files. Confirm with the read-only commands in §5 before claiming the site is up |
| npm audit | Last written baseline in the deployment guide era was backend 0, admin 0, frontend 3 moderate (build-time Tailwind/PostCSS). Re-run `npm audit` before quoting it |

Phase 1 application hardening concluded **CONDITIONAL GO** on the code gates of that date. Container and workflow files have landed since. Monitoring has not. A live cluster was not re-checked on 20 November 2026.

## 10. Still absent

These are not in the repository as running products:

- A monitoring, alerting, or log-aggregation stack. Webhook alerts are log lines. See [09-OPERATIONS.md](./09-OPERATIONS.md) §10.
- An automatic EKS rollout of the storefront and admin.
- A public Ingress host for the admin app.
- A MongoDB workload inside the Kubernetes manifests. The API expects an external database.
- Proof, in this documentation pass, of current DNS, certificates, or workflow success.

## 11. Post-deploy checks

Use these after a deploy you are authorized to inspect:

1. `GET /health/ready` returns 200 and `checks.database: true`.
2. The storefront origin can call `GET /api/product/list` (CORS or same-origin proxy).
3. Admin login (`POST /api/user/admin`) reaches a dashboard. On AWS this may be a port-forward until an admin host exists.
4. Invalid `POST /api/orders/paypal/webhook` body returns 400.
5. If you are validating PayPal sandbox: create, approve, capture, `paymentStatus: 'completed'`, and a `webhookevents` document in `completed`.
6. When Redis is configured, `/health/ready` shows `checks.realtime: redis`.

## 12. Local versus production Redis

`k8s/redis-deployment.yaml` and `k8s/redis-service.yaml` are local fixtures: one replica, no AUTH, no TLS, `emptyDir`, ClusterIP, 128 MB. They exist so more than one backend pod can share a pub/sub bus in a local cluster. Do not expose them with a NodePort, LoadBalancer, Ingress, or HTTPRoute.

| Concern | Local fixture | Production requirement |
| --- | --- | --- |
| Exposure | ClusterIP, no auth | Private network, AUTH and TLS (`rediss://`) |
| Availability | One pod, `emptyDir` | Managed Redis with failover |
| Capacity | 128 MB, `noeviction` | Sized for broadcast volume |
| Secrets | None | `REDIS_URL` from a Kubernetes Secret, not a ConfigMap |

```bash
kubectl -n novacart create secret generic novacart-redis \
  --from-literal=REDIS_URL='rediss://default:<password>@<host>:6380/0'
kubectl -n novacart set env deployment/novacart-backend \
  --from=secret/novacart-redis
kubectl -n novacart rollout status deployment/novacart-backend
```

For local kind, build the tag the manifest expects (`novacart-backend:v4`), load it into the cluster, apply the Redis manifests and `k8s/backend-configmap.yaml`, and restart `novacart-backend`. The ConfigMap’s `REDIS_URL` should point at the in-cluster Service.

```bash
kubectl -n novacart scale deployment/novacart-backend --replicas=3
kubectl -n novacart get pods -l app=novacart-backend -o wide
```

Scale only after Redis is healthy. Cross-pod delivery stays **UNVERIFIED** until an event emitted on pod A arrives at a client connected to pod B. `__tests__/socketRedisAdapter.spec.js` covers two Socket.IO servers in one process.

The AWS manifests do not include this Redis Deployment or the HPA. One replica is the committed AWS shape. Adding replicas there without Redis drops room events that land on another pod.
