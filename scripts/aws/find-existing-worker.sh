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

expected_profile = (
    "arn:aws:iam::942875993314:instance-profile/"
    "NovaCart-EKS-DeploymentWorkerProfile"
)

if instance.get("ImageId") != "ami-096ef200a877f36af":
    sys.exit("ERROR: Existing worker has unexpected AMI")

if instance.get("InstanceType") != "t3.small":
    sys.exit("ERROR: Existing worker has unexpected instance type")

if instance.get("IamInstanceProfile", {}).get("Arn") != expected_profile:
    sys.exit("ERROR: Existing worker has unexpected IAM profile")

if instance.get("SubnetId") != "subnet-0d6acd94e5822fc09":
    sys.exit("ERROR: Existing worker has unexpected subnet")

security_groups = {
    group["GroupId"]
    for group in instance.get("SecurityGroups", [])
}
if security_groups != {"sg-0d442aff54a847834"}:
    sys.exit("ERROR: Existing worker has unexpected security groups")

metadata = instance.get("MetadataOptions", {})
if (metadata.get("HttpTokens") != "required"
        or metadata.get("HttpEndpoint") != "enabled"):
    sys.exit("ERROR: Existing worker has insecure metadata settings")

if state not in ("pending", "running"):
    print(
        f"ERROR: Existing worker {instance_id} is {state}",
        file=sys.stderr,
    )
    sys.exit(3)

print(instance_id)
PY
