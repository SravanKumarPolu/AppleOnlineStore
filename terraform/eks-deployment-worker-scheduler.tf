# NovaCart Phase 4
# Independent expiration cleanup for temporary EC2 deployment workers.

data "aws_iam_policy_document" "deployment_worker_scheduler_trust" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["scheduler.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }

    condition {
      test     = "ArnEquals"
      variable = "aws:SourceArn"
      values = [
        "arn:aws:scheduler:us-east-1:${data.aws_caller_identity.current.account_id}:schedule-group/default"
      ]
    }
  }
}

resource "aws_iam_role" "deployment_worker_scheduler" {
  name = "NovaCart-EKS-WorkerCleanupSchedulerRole"

  assume_role_policy = data.aws_iam_policy_document.deployment_worker_scheduler_trust.json

  tags = {
    Name = "novacart-worker-cleanup-scheduler"
  }
}

resource "aws_iam_role_policy" "deployment_worker_scheduler_terminate" {
  name = "NovaCart-TerminateTaggedDeploymentWorkers"
  role = aws_iam_role.deployment_worker_scheduler.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "TerminateOnlyNovaCartDeploymentWorkers"
        Effect = "Allow"
        Action = "ec2:TerminateInstances"

        Resource = "arn:aws:ec2:us-east-1:${data.aws_caller_identity.current.account_id}:instance/*"

        Condition = {
          StringEquals = {
            "aws:ResourceTag/NovaCartPurpose" = "eks-deployment-worker"
            "aws:ResourceTag/ManagedBy"       = "github-automation"
          }
        }
      }
    ]
  })
}
