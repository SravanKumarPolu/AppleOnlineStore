#!/usr/bin/env bash
set -euo pipefail

DEPLOYMENT_ID="${1:-}"

if [[ ! "$DEPLOYMENT_ID" =~ ^github-[0-9]+-[0-9]+$ ]]; then
  echo "ERROR: Invalid deployment ID" >&2
  exit 1
fi

export AWS_REGION="us-east-1"

INSTANCES="$(aws ec2 describe-instances \
  --region "$AWS_REGION" \
  --filters \
    "Name=tag:NovaCartPurpose,Values=eks-deployment-worker" \
    "Name=tag:ManagedBy,Values=github-automation" \
    "Name=tag:NovaCartDeploymentId,Values=$DEPLOYMENT_ID" \
    "Name=instance-state-name,Values=pending,running,stopping,stopped" \
  --query 'Reservations[].Instances[]' \
  --output json)"

python3 - "$DEPLOYMENT_ID" "$INSTANCES" <<'PY'
import json
import sys

deployment_id = sys.argv[1]
instances = json.loads(sys.argv[2])

if len(instances) > 1:
    print(
        "ERROR: Multiple active workers found for deployment",
        file=sys.stderr,
    )
    sys.exit(2)

if not instances:
    print("NONE")
    sys.exit(0)

instance = instances[0]
tags = {
    tag["Key"]: tag["Value"]
    for tag in instance.get("Tags", [])
}

assert tags.get("NovaCartPurpose") == "eks-deployment-worker"
assert tags.get("ManagedBy") == "github-automation"
assert tags.get("NovaCartDeploymentId") == deployment_id

instance_id = instance["InstanceId"]
state = instance["State"]["Name"]

if state not in ("pending", "running"):
    print(
        f"ERROR: Existing worker {instance_id} is {state}",
        file=sys.stderr,
    )
    sys.exit(3)

print(instance_id)
PY
