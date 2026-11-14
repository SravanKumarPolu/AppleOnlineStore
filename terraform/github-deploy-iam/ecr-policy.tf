data "aws_iam_policy_document" "github_ecr_push" {
  statement {
    sid     = "ECRAuthentication"
    effect  = "Allow"
    actions = ["ecr:GetAuthorizationToken"]

    resources = ["*"]
  }

  statement {
    sid    = "PushNovaCartBackend"
    effect = "Allow"

    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:InitiateLayerUpload",
      "ecr:UploadLayerPart",
      "ecr:CompleteLayerUpload",
      "ecr:PutImage"
    ]

    resources = [
      "arn:aws:ecr:us-east-1:942875993314:repository/novacart/backend"
    ]
  }
}

resource "aws_iam_role_policy" "github_ecr_push" {
  name   = "novacart-backend-ecr-push"
  role   = aws_iam_role.github_deploy.id
  policy = data.aws_iam_policy_document.github_ecr_push.json
}
