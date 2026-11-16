import json
import subprocess
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(
    0, str(Path(__file__).resolve().parents[1])
)

import worker_lifecycle as lifecycle


DEPLOYMENT = "github-100-1"
INSTANCE = "i-0123456789abcdef0"

CONFIG = {
    "ClientToken": "novacart-github-100-1",
    "MinCount": 1,
    "MaxCount": 1,
}


def response(output="", code=0, error=""):
    return SimpleNamespace(
        returncode=code,
        stdout=output,
        stderr=error,
    )


class WorkerLifecycleTests(unittest.TestCase):

    def simulate(self, scenario):
        calls = []
        lookups = 0

        def runner(args):
            nonlocal lookups
            calls.append(args)

            if "find-existing-worker.sh" in str(args):
                lookups += 1

                if scenario == "lookup-failure":
                    return response(code=1, error="Lookup denied")

                if scenario == "existing":
                    return response(INSTANCE)

                return response(
                    "NONE" if lookups == 1 else INSTANCE
                )

            if "run-instances" in args:
                if scenario == "launch-timeout":
                    raise subprocess.TimeoutExpired(args, 120)

                if scenario == "malformed-response":
                    return response('{"Instances": [}')

                return response(json.dumps({
                    "Instances": [{"InstanceId": INSTANCE}]
                }))

            if "create-worker-cleanup-schedule.sh" in str(args):
                if scenario == "scheduler-timeout":
                    raise subprocess.TimeoutExpired(args, 120)

                if scenario in (
                    "scheduler-failure",
                    "termination-failure",
                    "termination-unconfirmed",
                ):
                    return response(code=1, error="Schedule failed")

                return response("Schedule verified")

            if "terminate-instances" in args:
                if scenario == "termination-failure":
                    return response(code=1, error="Access denied")
                return response()

            if "instance-terminated" in args:
                if scenario == "termination-unconfirmed":
                    return response(code=1, error="Waiter failed")
                return response()

            raise AssertionError(f"Unexpected operation: {args}")

        return runner, calls

    def test_new_worker(self):
        runner, calls = self.simulate("new")
        result = lifecycle.launch_and_schedule(
            DEPLOYMENT, CONFIG, runner
        )
        self.assertEqual(result, INSTANCE)
        self.assertEqual(
            sum("run-instances" in c for c in calls), 1
        )

    def test_existing_worker(self):
        runner, calls = self.simulate("existing")
        result = lifecycle.launch_and_schedule(
            DEPLOYMENT, CONFIG, runner
        )
        self.assertEqual(result, INSTANCE)
        self.assertFalse(
            any("run-instances" in c for c in calls)
        )

    def test_scheduler_failure_terminates(self):
        runner, calls = self.simulate("scheduler-failure")

        with self.assertRaisesRegex(
            lifecycle.LifecycleError,
            "termination was confirmed",
        ):
            lifecycle.launch_and_schedule(
                DEPLOYMENT, CONFIG, runner
            )

        self.assertTrue(
            any("terminate-instances" in c for c in calls)
        )
        self.assertTrue(
            any("instance-terminated" in c for c in calls)
        )

    def test_scheduler_timeout_terminates(self):
        runner, calls = self.simulate("scheduler-timeout")

        with self.assertRaises(lifecycle.LifecycleError):
            lifecycle.launch_and_schedule(
                DEPLOYMENT, CONFIG, runner
            )

        self.assertTrue(
            any("terminate-instances" in c for c in calls)
        )

    def test_termination_failure_reported(self):
        runner, _ = self.simulate("termination-failure")

        with self.assertRaisesRegex(
            lifecycle.LifecycleError, "CRITICAL"
        ):
            lifecycle.launch_and_schedule(
                DEPLOYMENT, CONFIG, runner
            )

    def test_unconfirmed_termination_reported(self):
        runner, _ = self.simulate("termination-unconfirmed")

        with self.assertRaisesRegex(
            lifecycle.LifecycleError, "CRITICAL"
        ):
            lifecycle.launch_and_schedule(
                DEPLOYMENT, CONFIG, runner
            )

    def test_lookup_failure_blocks_launch(self):
        runner, calls = self.simulate("lookup-failure")

        with self.assertRaises(lifecycle.LifecycleError):
            lifecycle.launch_and_schedule(
                DEPLOYMENT, CONFIG, runner
            )

        self.assertFalse(
            any("run-instances" in c for c in calls)
        )

    def test_launch_timeout_reconciled(self):
        runner, calls = self.simulate("launch-timeout")

        with patch.object(
            lifecycle, "reconcile_worker", return_value=INSTANCE
        ) as reconcile:
            result = lifecycle.launch_and_schedule(
                DEPLOYMENT, CONFIG, runner
            )

        self.assertEqual(result, INSTANCE)
        reconcile.assert_called_once()
        self.assertEqual(
            sum("run-instances" in c for c in calls), 1
        )

    def test_malformed_response_reconciled(self):
        runner, calls = self.simulate("malformed-response")

        with patch.object(
            lifecycle, "reconcile_worker", return_value=INSTANCE
        ) as reconcile:
            result = lifecycle.launch_and_schedule(
                DEPLOYMENT, CONFIG, runner
            )

        self.assertEqual(result, INSTANCE)
        reconcile.assert_called_once()
        self.assertEqual(
            sum("run-instances" in c for c in calls), 1
        )

    def test_invalid_client_token(self):
        runner, calls = self.simulate("new")
        bad_config = dict(CONFIG)
        bad_config["ClientToken"] = "wrong-token"

        with self.assertRaises(lifecycle.LifecycleError):
            lifecycle.launch_and_schedule(
                DEPLOYMENT, bad_config, runner
            )

        self.assertEqual(calls, [])


if __name__ == "__main__":
    unittest.main()
