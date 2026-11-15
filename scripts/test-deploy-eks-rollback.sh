#!/usr/bin/env bash
set -euo pipefail

SCRIPT="scripts/deploy-eks-backend.sh"
TEMP="$(mktemp)"
trap 'rm -f "$TEMP"' EXIT

# Extract only rollback functions, avoiding real AWS operations.
sed -n '/^rollback_on_failure() {/,/^echo "Recording previous image..."/p' \
  "$SCRIPT" | sed '$d' > "$TEMP"

source "$TEMP"

CLUSTER="novacart-aws-dev"
NAMESPACE="novacart"
DEPLOYMENT="novacart-backend"
CURRENT="registry/backend:old"
IMAGE="registry/backend:new"

mock_image="$IMAGE"
mock_version="123"
mock_patch_fail=0
patch_calls=0

kubectl() {
  local args=" $* "

  if [[ "$args" == *" get deployment "* ]]; then
    if [[ "$args" == *"metadata.resourceVersion"* ]]; then
      printf '%s %s' "$mock_version" "$mock_image"
    else
      printf '%s' "$mock_image"
    fi
  elif [[ "$args" == *" patch deployment "* ]]; then
    patch_calls=$((patch_calls + 1))
    if [[ "$mock_patch_fail" == 1 ]]; then
      return 1
    fi
    mock_image="$CURRENT"
    echo "Mock deployment patched"
  elif [[ "$args" == *" rollout status "* ]]; then
    echo "Mock rollout successful"
  else
    echo "Unexpected kubectl command: $*" >&2
    return 1
  fi
}

echo "TEST 1: Successful rollback"
mock_image="$IMAGE"
mock_patch_fail=0
patch_calls=0

rollback_on_failure
[[ "$mock_image" == "$CURRENT" ]]
[[ "$patch_calls" == 1 ]]
echo "PASS: Previous image restored"

echo
echo "TEST 2: Another deployment changed the image"
mock_image="registry/backend:someone-else"
patch_calls=0

if rollback_on_failure; then
  echo "FAIL: Should have refused rollback"
  exit 1
fi

[[ "$mock_image" == "registry/backend:someone-else" ]]
[[ "$patch_calls" == 0 ]]
echo "PASS: Concurrent image change protected"

echo
echo "TEST 3: Kubernetes rejects rollback patch"
mock_image="$IMAGE"
mock_patch_fail=1
patch_calls=0

if rollback_on_failure; then
  echo "FAIL: Patch failure was ignored"
  exit 1
fi

[[ "$mock_image" == "$IMAGE" ]]
[[ "$patch_calls" == 1 ]]
echo "PASS: Patch failure detected"

echo
echo "ALL MOCK ROLLBACK TESTS PASSED"
