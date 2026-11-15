#!/usr/bin/env bash
set -Eeuo pipefail

export AWS_PROFILE="${AWS_PROFILE:-novacart-dev}"
export AWS_REGION="us-east-1"

ACCOUNT="942875993314"
CLUSTER="novacart-aws-dev"
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
  echo "ERROR: Rollout failed."
  echo "Previous image saved in $BACKUP"
  exit 1
fi

echo "Verifying deployed image..."
ACTUAL="$(kubectl --context "$CLUSTER" \
  -n "$NAMESPACE" get deployment "$DEPLOYMENT" \
  -o jsonpath='{.spec.template.spec.containers[0].image}')"

[[ "$ACTUAL" == "$IMAGE" ]] || {
  echo "ERROR: Deployed image does not match target."
  exit 1
}

echo "Testing public APIs..."
python3 - <<'SMOKE_TEST'
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

echo "Deployment and basic API smoke tests passed."
