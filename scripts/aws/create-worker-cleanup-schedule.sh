#!/usr/bin/env bash
set -euo pipefail

REGION="us-east-1"
ACCOUNT_ID="942875993314"
ROLE_ARN="arn:aws:iam::${ACCOUNT_ID}:role/NovaCart-EKS-WorkerCleanupSchedulerRole"

MODE="${1:---check}"
INSTANCE_ID="${2:-i-0123456789abcdef0}"

if [[ "$MODE" != "--check" && "$MODE" != "--create" ]]; then
  echo "Usage: $0 --check | --create <instance-id>" >&2
  exit 1
fi

if [[ ! "$INSTANCE_ID" =~ ^i-[a-f0-9]{17}$ ]]; then
  echo "Invalid EC2 instance ID" >&2
  exit 1
fi

SCHEDULE_NAME="novacart-worker-expiry-${INSTANCE_ID}"

EXPIRY="$(python3 - <<'PY'
from datetime import datetime, timedelta, timezone
print((datetime.now(timezone.utc) + timedelta(minutes=60))
      .strftime("%Y-%m-%dT%H:%M:%S"))
PY
)"

TARGET="$(python3 - "$INSTANCE_ID" "$ROLE_ARN" <<'PY'
import json
import sys

instance_id, role_arn = sys.argv[1:]

target = {
    "Arn": "arn:aws:scheduler:::aws-sdk:ec2:terminateInstances",
    "RoleArn": role_arn,
    "Input": json.dumps({"InstanceIds": [instance_id]}),
    "RetryPolicy": {
        "MaximumEventAgeInSeconds": 3600,
        "MaximumRetryAttempts": 5
    }
}

print(json.dumps(target))
PY
)"

if [[ "$MODE" == "--check" ]]; then
  python3 - "$TARGET" "$INSTANCE_ID" <<'PY'
import json
import sys

target = json.loads(sys.argv[1])
payload = json.loads(target["Input"])

assert payload["InstanceIds"] == [sys.argv[2]]
assert target["Arn"].endswith(":ec2:terminateInstances")

print("PASS: Scheduler target JSON valid")
print("PASS: EC2 instance ID matches")
print("PASS: No AWS resources created")
PY
  exit 0
fi

# Verify this instance belongs to the temporary deployment worker fleet.
INSTANCE="$(aws ec2 describe-instances \
  --region "$REGION" \
  --instance-ids "$INSTANCE_ID" \
  --query 'Reservations[0].Instances[0]' \
  --output json)"

python3 - "$INSTANCE" "$INSTANCE_ID" "$ACCOUNT_ID" <<'PY'
import json
import sys

instance = json.loads(sys.argv[1])
instance_id, account_id = sys.argv[2:]

tags = {tag["Key"]: tag["Value"] for tag in instance.get("Tags", [])}
profile = instance.get("IamInstanceProfile", {}).get("Arn")

assert instance["InstanceId"] == instance_id
assert instance["State"]["Name"] in ("pending", "running")
assert tags.get("NovaCartPurpose") == "eks-deployment-worker"
assert tags.get("ManagedBy") == "github-automation"
assert profile == (
    f"arn:aws:iam::{account_id}:instance-profile/"
    "NovaCart-EKS-DeploymentWorkerProfile"
)

print("PASS: Approved deployment worker verified")
PY

aws scheduler create-schedule \
  --region "$REGION" \
  --name "$SCHEDULE_NAME" \
  --schedule-expression "at(${EXPIRY})" \
  --schedule-expression-timezone UTC \
  --flexible-time-window '{"Mode":"OFF"}' \
  --action-after-completion DELETE \
  --target "$TARGET"

SCHEDULE="$(aws scheduler get-schedule \
  --region "$REGION" \
  --name "$SCHEDULE_NAME" \
  --output json)"

python3 - "$SCHEDULE" "$INSTANCE_ID" "$ROLE_ARN" "$EXPIRY" <<'PY'
import json
import sys

schedule = json.loads(sys.argv[1])
instance_id, role_arn, expiry = sys.argv[2:]

target = schedule["Target"]
payload = json.loads(target["Input"])

assert schedule["State"] == "ENABLED"
assert schedule["ScheduleExpression"] == f"at({expiry})"
assert target["RoleArn"] == role_arn
assert target["Arn"] == "arn:aws:scheduler:::aws-sdk:ec2:terminateInstances"
assert payload["InstanceIds"] == [instance_id]

print("PASS: AWS cleanup schedule verified")
print("Schedule:", schedule["Name"])
print("Expiry (UTC):", expiry)
PY
