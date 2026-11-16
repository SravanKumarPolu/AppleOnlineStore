"""EC2 worker lifecycle. Not yet connected to the live launcher."""

import json
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
LOOKUP = ROOT / "scripts/aws/find-existing-worker.sh"
SCHEDULER = ROOT / "scripts/aws/create-worker-cleanup-schedule.sh"
REGION = "us-east-1"


class LifecycleError(RuntimeError):
    pass


def run_command(args):
    return subprocess.run(
        args,
        cwd=ROOT,
        capture_output=True,
        text=True,
        timeout=120,
        check=False,
    )


def lookup(deployment, runner=run_command):
    result = runner(["bash", str(LOOKUP), deployment])
    if result.returncode:
        raise LifecycleError(
            f"Worker lookup failed: {result.stderr}"
        )

    worker = result.stdout.strip()

    if worker != "NONE" and not re.fullmatch(
        r"i-[a-f0-9]{17}", worker
    ):
        raise LifecycleError("Invalid worker lookup response")

    return worker


def terminate_verified(instance_id, deployment, runner):
    """Terminate only the worker confirmed by the lookup helper."""
    verified = lookup(deployment, runner)

    if verified != instance_id:
        raise LifecycleError(
            f"Termination blocked: worker verification failed. "
            f"Expected {instance_id}, found {verified}"
        )

    result = runner([
        "aws", "ec2", "terminate-instances",
        "--region", REGION,
        "--instance-ids", instance_id,
    ])

    if result.returncode:
        raise LifecycleError(
            f"Termination request failed for {instance_id}: "
            f"{result.stderr}"
        )

    result = runner([
        "aws", "ec2", "wait", "instance-terminated",
        "--region", REGION,
        "--instance-ids", instance_id,
    ])

    if result.returncode:
        raise LifecycleError(
            f"Termination not confirmed for {instance_id}: "
            f"{result.stderr}"
        )


def launch_and_schedule(deployment, config, runner=run_command):
    """Run one deployment's launch and cleanup registration."""
    expected_token = f"novacart-{deployment}"

    if not re.fullmatch(r"github-[0-9]+-[0-9]+", deployment):
        raise LifecycleError("Invalid deployment identifier")

    if config.get("ClientToken") != expected_token:
        raise LifecycleError("EC2 client token mismatch")

    if config.get("MinCount") != 1 or config.get("MaxCount") != 1:
        raise LifecycleError("Expected exactly one worker per request")

    instance_id = lookup(deployment, runner)

    if instance_id == "NONE":
        result = runner([
            "aws", "ec2", "run-instances",
            "--region", REGION,
            "--cli-input-json", json.dumps(config),
            "--output", "json",
        ])

        if result.returncode:
            # The API may have created an instance even if its response
            # was lost. Do not launch again with a different token.
            recovered = lookup(deployment, runner)
            if recovered == "NONE":
                raise LifecycleError(
                    "EC2 launch outcome uncertain. "
                    f"Client token: {expected_token}. "
                    "Reconcile AWS state before retrying."
                )
            instance_id = recovered
        else:
            try:
                instances = json.loads(result.stdout)["Instances"]
                if len(instances) != 1:
                    raise ValueError("Unexpected instance count")
                instance_id = instances[0]["InstanceId"]
                if not re.fullmatch(r"i-[a-f0-9]{17}", instance_id):
                    raise ValueError("Invalid instance ID")
            except (KeyError, ValueError, TypeError) as exc:
                raise LifecycleError(
                    "EC2 response cannot be verified; "
                    f"client token: {expected_token}"
                ) from exc

    schedule = runner([
        "bash", str(SCHEDULER), "--create", instance_id
    ])

    if schedule.returncode:
        try:
            terminate_verified(instance_id, deployment, runner)
        except (LifecycleError, subprocess.TimeoutExpired) as exc:
            raise LifecycleError(
                f"CRITICAL: Schedule registration failed for "
                f"{instance_id}, and termination is not confirmed: "
                f"{exc}"
            ) from exc

        raise LifecycleError(
            f"Cleanup schedule failed; worker {instance_id} "
            "was terminated and termination was confirmed."
        )

    return instance_id
