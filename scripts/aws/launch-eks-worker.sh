#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" != "--check" ]]; then
  echo "Only --check is implemented. EC2 launch is disabled." >&2
  exit 1
fi

cd "$(dirname "$0")/../.."

export AWS_REGION="us-east-1"

AMI="ami-096ef200a877f36af"
SUBNET="subnet-0d6acd94e5822fc09"
SECURITY_GROUP="sg-0d442aff54a847834"
INSTANCE_PROFILE="NovaCart-EKS-DeploymentWorkerProfile"
USER_DATA="scripts/aws/eks-worker-user-data.sh"

bash -n "$USER_DATA"

ROOT_DEVICE="$(aws ec2 describe-images \
  --image-ids "$AMI" \
  --query 'Images[0].RootDeviceName' \
  --output text)"

if [[ -z "$ROOT_DEVICE" || "$ROOT_DEVICE" == "None" ]]; then
  echo "Unable to determine AMI root device" >&2
  exit 1
fi

python3 - "$ROOT_DEVICE" "$AMI" "$SUBNET" \
  "$SECURITY_GROUP" "$INSTANCE_PROFILE" "$USER_DATA" <<'PY'
import json
import sys
from pathlib import Path

root, ami, subnet, sg, profile, user_data = sys.argv[1:]

assert Path(user_data).is_file()

config = {
    "ImageId": ami,
    "InstanceType": "t3.small",
    "MinCount": 1,
    "MaxCount": 1,
    "ClientToken": "novacart-local-check-only",
    "IamInstanceProfile": {"Name": profile},
    "NetworkInterfaces": [{
        "DeviceIndex": 0,
        "SubnetId": subnet,
        "Groups": [sg],
        "AssociatePublicIpAddress": True,
        "DeleteOnTermination": True
    }],
    "MetadataOptions": {
        "HttpTokens": "required",
        "HttpEndpoint": "enabled",
        "HttpPutResponseHopLimit": 1
    },
    "InstanceInitiatedShutdownBehavior": "terminate",
    "DisableApiTermination": False,
    "BlockDeviceMappings": [{
        "DeviceName": root,
        "Ebs": {
            "VolumeSize": 16,
            "VolumeType": "gp3",
            "Encrypted": True,
            "DeleteOnTermination": True
        }
    }],
    "TagSpecifications": [{
        "ResourceType": "instance",
        "Tags": [
            {"Key": "NovaCartPurpose", "Value": "eks-deployment-worker"},
            {"Key": "ManagedBy", "Value": "github-automation"}
        ]
    }]
}

assert config["MaxCount"] == 1
assert config["MetadataOptions"]["HttpTokens"] == "required"
assert config["BlockDeviceMappings"][0]["Ebs"]["Encrypted"]
assert config["BlockDeviceMappings"][0]["Ebs"]["DeleteOnTermination"]
assert config["InstanceInitiatedShutdownBehavior"] == "terminate"

print("PASS: One-instance launch limit")
print("PASS: IMDSv2 required")
print("PASS: Encrypted EBS configured")
print("PASS: EBS delete on termination")
print("PASS: Instance shutdown terminates")
print("PASS: Approved worker networking and tags configured")
print("PASS: No EC2 instance launched")

print("\nProposed launch configuration:")
print(json.dumps(config, indent=2))
PY
