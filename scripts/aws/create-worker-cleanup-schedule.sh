#!/usr/bin/env bash
set -euo pipefail

# Usage: create-worker-cleanup-schedule.sh i-xxxxxxxxxxxxxxxxx
# Schedule a termination request for an existing temporary worker.

INSTANCE_ID="${1:?Provide EC2 instance ID}"
REGION="us-east-1"
ACCOUNT_ID="942875993314"
ROLE_ARN="arn:aws:iam::${ACCOUNT_ID}:role/NovaCart-EKS-WorkerCleanupSchedulerRole"

if [[ ! "$INSTANCE_ID" =~ ^i-[a-f0-9]{17}$ ]]; then
  echo "Invalid EC2 instance ID" >&2
  exit 1
fi

SCHEDULE_NAME="novacart-worker-expiry-${INSTANCE_ID}"

# Generate UTC expiry time consistently on macOS and Linux.
EXPIRY="$(python3 - <<'PY'
from datetime import datetime, timedelta, timezone
print((datetime.now(timezone.utc) + timedelta(minutes=60))
      .strftime('%Y-%m-%dT%H:%M:%S'))
PY
)"

TARGET="$(printf \
  '{"Arn":"arn:aws:scheduler:::aws-sdk:ec2:terminateInstances","RoleArn":"%s","Input":"{\\"InstanceIds\\":[\\"%s\\"]}","RetryPolicy":{"MaximumEventAgeInSeconds":3600,"MaximumRetryAttempts":5}}' \
  "$ROLE_ARN" "$INSTANCE_ID")"

aws scheduler create-schedule \
  --region "$REGION" \
  --name "$SCHEDULE_NAME" \
  --schedule-expression "at(${EXPIRY})" \
  --schedule-expression-timezone UTC \
  --flexible-time-window '{"Mode":"OFF"}' \
  --action-after-completion DELETE \
  --target "$TARGET"

# Fail if schedule creation cannot be confirmed.
aws scheduler get-schedule \
  --region "$REGION" \
  --name "$SCHEDULE_NAME" \
  --query '{Name:Name,State:State,Expression:ScheduleExpression,Target:Target.Arn}' \
  --output json
