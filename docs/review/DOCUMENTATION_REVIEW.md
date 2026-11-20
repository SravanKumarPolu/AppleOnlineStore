# NovaCart documentation review — 20 November 2026

**Input:** the `NovaCart_Documentation_Update` folder (review notes dated 20 November 2026 against a source snapshot described as 18 November 2026), integrated into this working tree on the same day.

**Method:** static comparison of those notes with the repository. No `npm` test run, CI re-run, `terraform apply`, AWS API call, HTTP probe, or PayPal transaction was executed for the integration.

## Confirmed from files in this tree

- Dockerfiles in `backend/`, `frontend/`, and `admin/`. Backend runtime is Node 24 Alpine, non-root, `CMD ["node", "server.js"]`. Storefront and admin are multi-stage builds ending in unprivileged Nginx on port 8080, proxying `/api/` and `/socket.io/` to `backend:3001`.
- `compose.yaml`: three services, image tags `novacart-backend:v2`, `novacart-frontend:v3`, `novacart-admin:v2`, loopback port bindings, backend `/health/ready` gate. No `build:` key.
- Local manifests in `k8s/`, including `backend-hpa.yaml` (1–3 replicas) and a Redis Deployment/Service. Local HTTPRoutes use `shop.novacart.localhost` and `admin.novacart.localhost`.
- `k8s/aws/`: Deployments and Services for all three apps at one replica, probes on the backend, and an ALB Ingress for `novakart.xyz` and `www.novakart.xyz` only.
- Terraform for VPC/networking, IAM, ECR (three repositories), and EKS cluster `novacart-dev-eks`. `terraform/ecr.tf` still says configuration only, do not apply yet.
- `.github/workflows/novacart-ci-cd.yml` verifies three apps, scans images, publishes three images to GHCR on a `main` push, and publishes the backend image to ECR.
- `.github/workflows/novacart-eks-deploy.yml` is manual and updates `novacart-backend` only, with conditional rollback in `scripts/deploy-eks-backend.sh`.
- Additional workflows: `novacart-eks-auth.yml` and `aws-oidc-test.yml` (manual identity checks) and `novacart-worker-tests.yml` (worker-script unit tests). None of them deploy the three applications.
- The storefront Socket.IO client reconnects and replays order-room subscriptions; the admin app also opens an authenticated connection through `admin/src/context/RealtimeProvider.tsx`, and its Orders page consumes `new_order` and `order_updated`. Both client integrations are covered by app tests.
- PayPal webhook verification is implemented and tested with mocks. The sandbox checklist still marks a real signed round trip unverified.

## Corrections applied during integration

1. Root `README.md` and `docs/06-DEPLOYMENT.md` no longer say Docker, Compose, GitHub Actions, and Terraform are absent.
2. The new deployment guide keeps the previous operational material that was still accurate: PayPal setup, the environment-variable table, health and shutdown, credential gates, and the local-versus-production Redis section. The PayPal section matches the K-2 fix (no hardcoded client id). CORS is described as environment-driven. The old “35 variables” heading is replaced by the 46-name template.
3. `docs/01-PRD.md` feature row and non-goals no longer list Docker/CI as missing. Monitoring stays Planned.
4. `docs/architecture/SYSTEM_ARCHITECTURE.md` and `docs/architecture/DEVOPS_BASELINE.md` keep their 2026-10-26 application findings and now point at this deployment set so the old “not implemented” labels are not the current infrastructure statement.
5. `AGENTS.md` documentation map describes `docs/06-DEPLOYMENT.md` as the current deployment guide.
6. Historical reports under `docs/devops/` and `docs/10-FINAL-STABILIZATION-REPORT.md` were not rewritten. Sentences there about “no infrastructure” describe the change set on the date of that report.
7. The supplied README and deployment notes incorrectly said the admin dashboard used REST only. `admin/src/context/RealtimeProvider.tsx` and `admin/src/pages/orders.tsx` establish an authenticated Socket.IO client and live order-event subscriptions, so current docs now describe both clients; the 2026-10-26 architecture audit is explicitly labeled historical.

## Outdated material left in place on purpose

- `docs/testing/FINAL_TEST_EXECUTION.md` and similar files under `docs/testing/` are evidence for the run they name. The 2026-10-26 counts (43 suites / 441 backend tests, 125 storefront tests, 70 admin tests, 51 browser checks) are lower than the 2026-10-27 and 2026-11-04 notes in `AGENTS.md` (backend 47 suites / 534 tests; storefront 25 files / 142; admin 13 files / 71; 54 browser checks). One command line in `AGENTS.md` still says 70 admin tests. None of these counts were re-executed on 20 November 2026.
- `docs/testing/PRE_DEVOPS_READINESS.md` and `docs/devops/00-PRE-DEVOPS-QUALITY-BASELINE.md` describe the repository before the deployment artifacts were added. Their statements that Docker, Kubernetes, Terraform, or CI workflows were absent are historical; use [`docs/06-DEPLOYMENT.md`](../06-DEPLOYMENT.md) and [`docs/architecture/DEPLOYMENT_ARCHITECTURE.md`](../architecture/DEPLOYMENT_ARCHITECTURE.md) for the current repository snapshot.
- `docs/testing/KNOWN_LIMITATIONS.md` and Phase 1 devops reports contain earlier payment and inventory wording. Later defect notes in `docs/01-PRD.md` (K-1, K-5, K-13, K-14, K-15, K-17, K-21) supersede them for current behavior. Those history files were not merged into the deployment guide.
- `docs/architecture/SYSTEM_ARCHITECTURE.md` still contains the original proposed-infrastructure diagram so the 2026-10-26 baseline stays readable. The banner at the top is the current pointer.

## Not established by this review

- A running EKS cluster, healthy pods, a passing production HTTP check, uptime, or traffic.
- Public HTTPS on `admin.novakart.xyz`. The name does not appear as an Ingress host.
- That `novakart.xyz` or `www.novakart.xyz` resolve and serve the committed image tags today.
- End-to-end PayPal approval, capture, and a signed webhook, or real SMTP delivery.
- The result of the latest GitHub Actions runs, or whether cloud resources were destroyed after they were applied.
- That the local HPA ever scaled pods in AWS. The HPA manifest is not in `k8s/aws/`.
- Today’s test totals.

## Publication notes

Integration was documentation-only: no application source, workflow, Terraform, Kubernetes manifest, or environment file was edited. Do not commit `.env` files, kubeconfigs, or credentials with the doc change. Run the test and lint commands in `docs/06-DEPLOYMENT.md` §4 before treating a branch as release-ready; this review did not run them.
