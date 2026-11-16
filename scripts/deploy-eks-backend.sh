#!/usr/bin/env bash
set -Eeuo pipefail

# Use AWS_PROFILE when explicitly supplied; otherwise use the default AWS credential chain.
export AWS_REGION="us-east-1"

ACCOUNT="942875993314"
CLUSTER="novacart-dev-eks"
NAMESPACE="novacart"
DEPLOYMENT="novacart-backend"
CONTAINER="backend"
REPOSITORY="novacart/backend"
REGISTRY="${ACCOUNT}.dkr.ecr.${AWS_REGION}.amazonaws.com"
BACKUP="/tmp/novacart-eks-backend-previous-image.txt"

MODE="${1:---dry-run}"
SHA="${2:-}"

if [[ "$MODE" != "--dry-run" && "$MODE" != "--apply" ]]; then
  echo "Usage: $0 --dry-run|--apply <40-character-git-sha>"
  exit 1
fi

if [[ ! "$SHA" =~ ^[0-9a-f]{40}$ ]]; then
  echo "ERROR: Provide a full 40-character Git commit SHA."
  exit 1
fi

IMAGE="${REGISTRY}/${REPOSITORY}:${SHA}"

echo "Checking AWS identity..."
CALLER_ACCOUNT="$(aws sts get-caller-identity \
  --query Account --output text)"

[[ "$CALLER_ACCOUNT" == "$ACCOUNT" ]] || {
  echo "ERROR: Wrong AWS account."
  exit 1
}

echo "Checking Kubernetes context..."
kubectl config get-contexts "$CLUSTER" >/dev/null

echo "Checking ECR image..."
aws ecr describe-images \
  --repository-name "$REPOSITORY" \
  --image-ids "imageTag=${SHA}" \
  --region "$AWS_REGION" \
  --query 'imageDetails[0].imageDigest' \
  --output text

echo "Checking deployment container..."
CONTAINERS="$(kubectl --context "$CLUSTER" \
  -n "$NAMESPACE" get deployment "$DEPLOYMENT" \
  -o jsonpath='{.spec.template.spec.containers[*].name}')"

if [[ "$CONTAINERS" != "$CONTAINER" ]]; then
  echo "ERROR: Unexpected deployment containers: $CONTAINERS"
  exit 1
fi

echo "Checking current deployment..."
CURRENT="$(kubectl --context "$CLUSTER" \
  -n "$NAMESPACE" get deployment "$DEPLOYMENT" \
  -o jsonpath='{.spec.template.spec.containers[0].image}')"

echo "Current: $CURRENT"
echo "Target:  $IMAGE"

if [[ "$CURRENT" == "$IMAGE" ]]; then
  echo "Image already deployed. No changes required."
  exit 0
fi

if [[ "$MODE" == "--dry-run" ]]; then
  echo "DRY RUN PASSED: No Kubernetes changes made."
  exit 0
fi

rollback_on_failure() {
  echo "ERROR: Deployment verification failed."
  echo "Checking whether automatic rollback is safe..."

  local snapshot current_image version patch

  if ! snapshot="$(kubectl --context "$CLUSTER" -n "$NAMESPACE" \
    get deployment "$DEPLOYMENT" \
    -o jsonpath='{.metadata.resourceVersion}{" "}{.spec.template.spec.containers[0].image}')"; then
    echo "Cannot inspect deployment. Manual recovery required."
    return 1
  fi

  version="${snapshot%% *}"
  current_image="${snapshot#* }"

  if [[ "$current_image" != "$IMAGE" ]]; then
    echo "Deployment image changed since this run."
    echo "Current image: $current_image"
    echo "Automatic rollback skipped to protect newer changes."
    return 1
  fi

  printf -v patch \
    '[{"op":"test","path":"/metadata/resourceVersion","value":"%s"},{"op":"test","path":"/spec/template/spec/containers/0/image","value":"%s"},{"op":"replace","path":"/spec/template/spec/containers/0/image","value":"%s"}]' \
    "$version" "$IMAGE" "$CURRENT"

  echo "Restoring previous image: $CURRENT"

  if ! kubectl --context "$CLUSTER" -n "$NAMESPACE" \
    patch deployment "$DEPLOYMENT" \
    --type=json -p "$patch"; then
    echo "Rollback patch rejected or failed."
    echo "Inspect deployment before attempting manual recovery."
    return 1
  fi

  if ! kubectl --context "$CLUSTER" -n "$NAMESPACE" \
    rollout status "deployment/$DEPLOYMENT" --timeout=180s; then
    echo "Rollback rollout did not complete successfully."
    return 1
  fi

  local restored_image

  if ! restored_image="$(kubectl --context "$CLUSTER"     -n "$NAMESPACE" get deployment "$DEPLOYMENT"     -o jsonpath='{.spec.template.spec.containers[0].image}')"; then
    echo "ERROR: Could not verify rollback image."
    return 1
  fi

  if [[ "$restored_image" != "$CURRENT" ]]; then
    echo "ERROR: Rollback image does not match previous image."
    echo "Expected: $CURRENT"
    echo "Actual:   $restored_image"
    return 1
  fi

  echo "Rollback completed and previous image verified."
  return 0
}

deployment_failed() {
  rollback_on_failure || true
  echo "Deployment failed; inspect cluster state."
  exit 1
}

echo "Recording previous image..."
printf '%s\n' "$CURRENT" > "$BACKUP"

echo "Deploying new image..."
kubectl --context "$CLUSTER" -n "$NAMESPACE" \
  set image "deployment/${DEPLOYMENT}" \
  "${CONTAINER}=${IMAGE}"

echo "Waiting for rollout..."
if ! kubectl --context "$CLUSTER" -n "$NAMESPACE" \
  rollout status "deployment/${DEPLOYMENT}" \
  --timeout=180s; then
  deployment_failed
fi

echo "Verifying deployed image..."
ACTUAL="$(kubectl --context "$CLUSTER" \
  -n "$NAMESPACE" get deployment "$DEPLOYMENT" \
  -o jsonpath='{.spec.template.spec.containers[0].image}')"

[[ "$ACTUAL" == "$IMAGE" ]] || {
  echo "ERROR: Deployed image does not match target."
  deployment_failed
}

echo "Testing public APIs..."
if python3 - <<'SMOKE_TEST'
import json
import urllib.request

for path, field in [
    ("/api/category/list", "categories"),
    ("/api/product/list", "products"),
]:
    url = "https://novakart.xyz" + path

    with urllib.request.urlopen(url, timeout=20) as response:
        content_type = response.headers.get("Content-Type", "")
        assert response.status == 200, f"{path}: unexpected HTTP status"
        assert "application/json" in content_type, f"{path}: not JSON"

        data = json.load(response)
        assert data.get("success") is True, f"{path}: API failed"
        assert isinstance(data.get(field), list), f"{path}: missing {field}"
        assert len(data[field]) > 0, f"{path}: empty {field}"

        print(f"PASS: {path} ({len(data[field])} records)")
SMOKE_TEST
then
  echo "Deployment and basic API smoke tests passed."
else
  echo "API smoke tests failed."
  deployment_failed
fi
