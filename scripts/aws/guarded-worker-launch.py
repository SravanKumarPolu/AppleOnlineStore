#!/usr/bin/env python3
"""NovaCart guarded EC2 deployment worker lifecycle."""

import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
LAUNCHER = ROOT / "scripts/aws/launch-eks-worker.sh"
LOOKUP = ROOT / "scripts/aws/find-existing-worker.sh"
SCHEDULER = ROOT / "scripts/aws/create-worker-cleanup-schedule.sh"

ACCOUNT = "942875993314"
REGION = "us-east-1"
ROLE_PREFIX = (
    f"arn:aws:sts::{ACCOUNT}:assumed-role/"
    "novacart-github-eks-deploy/"
)


def command(args, *, env=None):
    return subprocess.run(
        args,
        cwd=ROOT,
        env=env,
        text=True,
        capture_output=True,
        timeout=90,
    )


def preflight():
    """Validate configuration without creating any AWS resources."""
    deployment = os.environ.get(
        "NOVACART_DEPLOYMENT_ID", "github-100-1"
    )

    if not re.fullmatch(r"github-[0-9]+-[0-9]+", deployment):
        raise RuntimeError("Invalid GitHub deployment ID")

    env = os.environ.copy()
    env["NOVACART_ROOT_DEVICE"] = "/dev/xvda"
    env["NOVACART_DEPLOYMENT_ID"] = deployment

    result = command(["bash", str(LAUNCHER), "--check"], env=env)
    if result.returncode:
        raise RuntimeError(result.stderr)

    marker = "Proposed launch configuration:\n"
    if marker not in result.stdout:
        raise RuntimeError("Launch configuration missing")

    config = json.loads(result.stdout.split(marker, 1)[1])

    assert config["MinCount"] == config["MaxCount"] == 1
    assert config["InstanceType"] == "t3.small"
    assert config["CreditSpecification"]["CpuCredits"] == "standard"
    assert config["MetadataOptions"]["HttpTokens"] == "required"
    assert config["InstanceInitiatedShutdownBehavior"] == "terminate"
    assert config["ClientToken"] == f"novacart-{deployment}"

    tags = {
        item["ResourceType"]: {
            tag["Key"]: tag["Value"]
            for tag in item["Tags"]
        }
        for item in config["TagSpecifications"]
    }

    assert set(tags) == {"instance", "volume"}
    assert tags["instance"] == tags["volume"]
    assert tags["instance"]["NovaCartDeploymentId"] == deployment
    assert tags["instance"]["NovaCartPurpose"] == "eks-deployment-worker"
    assert tags["instance"]["ManagedBy"] == "github-automation"

    assert config["BlockDeviceMappings"][0]["Ebs"]["Encrypted"]
    assert config["BlockDeviceMappings"][0]["Ebs"]["DeleteOnTermination"]
    assert config["UserData"]

    print("PASS: Approved EC2 launch configuration")
    print("PASS: Deployment-specific client token")
    print("PASS: Instance and EBS deployment tags")
    print("PASS: Encrypted EBS and IMDSv2")
    print("PASS: Shutdown-on-expiry configuration")
    return deployment, config


def verify_github_identity(deployment):
    if (
        os.environ.get("GITHUB_ACTIONS") != "true"
        or os.environ.get("GITHUB_REF") != "refs/heads/main"
        or os.environ.get("GITHUB_REPOSITORY")
        != "SravanKumarPolu/AppleOnlineStore"
    ):
        raise RuntimeError("Approved GitHub main-branch context required")

    run = os.environ.get("GITHUB_RUN_ID", "")
    attempt = os.environ.get("GITHUB_RUN_ATTEMPT", "")

    if deployment != f"github-{run}-{attempt}":
        raise RuntimeError("Deployment ID differs from GitHub run identity")

    result = command([
        "aws", "sts", "get-caller-identity",
        "--region", REGION, "--output", "json",
    ])

    if result.returncode:
        raise RuntimeError(result.stderr)

    identity = json.loads(result.stdout)

    if (
        identity["Account"] != ACCOUNT
        or not identity["Arn"].startswith(ROLE_PREFIX)
    ):
        raise RuntimeError("Unexpected AWS identity")

    print("PASS: GitHub OIDC deployment identity")


def find_worker(deployment):
    result = command(["bash", str(LOOKUP), deployment])
    if result.returncode:
        raise RuntimeError(
            "Worker lookup failed: " + result.stderr
        )
    value = result.stdout.strip()
    if value != "NONE" and not re.fullmatch(r"i-[a-f0-9]{17}", value):
        raise RuntimeError("Invalid worker lookup response")
    return value


def check_only():
    preflight()
    result = command(["bash", str(SCHEDULER), "--check"])
    if result.returncode:
        raise RuntimeError(result.stderr)
    print("PASS: Scheduler payload validation")
    print("PASS: No AWS resources created")


def main():
    parser = argparse.ArgumentParser()
    modes = parser.add_mutually_exclusive_group(required=True)
    modes.add_argument(
        "--check", action="store_true",
        help="Validate configuration without creating AWS resources",
    )
    modes.add_argument(
        "--launch", action="store_true",
        help="Request a guarded EC2 launch",
    )
    modes.add_argument(
        "--lookup", action="store_true",
        help="Find an existing deployment worker without modifying AWS",
    )
    args = parser.parse_args()

    if args.check:
        check_only()
        return

    deployment, config = preflight()

    if args.lookup:
        worker = find_worker(deployment)
        if worker == "NONE":
            print("PASS: No existing worker for deployment")
        else:
            print(f"PASS: Verified existing worker: {worker}")
        print("PASS: Read-only worker lookup completed")
        return

    verify_github_identity(deployment)

    # This gate remains closed until lifecycle failure tests pass.
    if os.environ.get("NOVACART_ENABLE_REAL_LAUNCH") != "approved":
        raise RuntimeError(
            "BLOCKED: Real launch is not enabled. "
            "Lifecycle testing remains pending."
        )

    raise RuntimeError(
        "BLOCKED: EC2 RunInstances integration is not implemented yet."
    )


if __name__ == "__main__":
    try:
        main()
    except (AssertionError, RuntimeError, ValueError,
            KeyError, subprocess.TimeoutExpired) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
