
# NovaCart Phase 4.6.5
# ECS IAM roles — configuration only.
# Do not run terraform apply yet.

data "aws_caller_identity" "current" {}

data "aws_iam_policy_document" "ecs_task_trust" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }

    condition {
      test     = "ArnLike"
      variable = "aws:SourceArn"
      values = [
        "arn:aws:ecs:us-east-1:${data.aws_caller_identity.current.account_id}:*"
      ]
    }
  }
}

resource "aws_iam_role" "ecs_execution" {
  name               = "novacart-dev-ecs-execution-role"
  assume_role_policy = data.aws_iam_policy_document.ecs_task_trust.json

  tags = {
    Name = "novacart-dev-ecs-execution-role"
  }
}

resource "aws_iam_role_policy_attachment" "ecs_execution" {
  role = aws_iam_role.ecs_execution.name

  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

data "aws_iam_policy_document" "ecs_ssm_read" {
  statement {
    sid     = "ReadNovaCartParameters"
    effect  = "Allow"
    actions = ["ssm:GetParameters"]

    resources = [
      for name in [
        "MONGODB_URI",
        "JWT_SECRET",
        "ADMIN_PASSWORD",
        "PAYPAL_CLIENT_SECRET",
        "CLOUDINARY_SECRET_KEY",
        "SMTP_PASS"
      ] :
      "arn:aws:ssm:us-east-1:${data.aws_caller_identity.current.account_id}:parameter/novacart/dev/${name}"
    ]
  }
}

resource "aws_iam_role_policy" "ecs_ssm_read" {
  name   = "novacart-dev-ecs-ssm-read"
  role   = aws_iam_role.ecs_execution.id
  policy = data.aws_iam_policy_document.ecs_ssm_read.json
}

resource "aws_iam_role" "ecs_task" {
  name               = "novacart-dev-ecs-task-role"
  assume_role_policy = data.aws_iam_policy_document.ecs_task_trust.json

  tags = {
    Name = "novacart-dev-ecs-task-role"
  }
}
