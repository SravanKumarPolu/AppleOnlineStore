# GitHub Actions -> EKS deployment identity.
# Reuses the existing GitHub OIDC trust policy, restricted to main.

resource "aws_iam_role" "github_eks_deploy" {
  name = "novacart-github-eks-deploy"

  description = "Least-privilege GitHub Actions EKS deployment role"

  assume_role_policy = data.aws_iam_policy_document.github_assume_role.json

  max_session_duration = 3600
}

data "aws_iam_policy_document" "github_eks_describe" {
  statement {
    sid     = "DescribeNovaCartEKS"
    effect  = "Allow"
    actions = ["eks:DescribeCluster"]

    resources = [
      "arn:aws:eks:us-east-1:942875993314:cluster/novacart-dev-eks"
    ]
  }

  # Required by scripts/deploy-eks-backend.sh
  statement {
    sid     = "DescribeNovaCartBackendECR"
    effect  = "Allow"
    actions = ["ecr:DescribeImages"]

    resources = [
      "arn:aws:ecr:us-east-1:942875993314:repository/novacart/backend"
    ]
  }
}

resource "aws_iam_role_policy" "github_eks_describe" {
  name = "novacart-eks-describe"

  role   = aws_iam_role.github_eks_deploy.id
  policy = data.aws_iam_policy_document.github_eks_describe.json
}

resource "aws_eks_access_entry" "github_eks_deploy" {
  cluster_name  = "novacart-dev-eks"
  principal_arn = aws_iam_role.github_eks_deploy.arn

  type = "STANDARD"

  kubernetes_groups = [
    "novacart-backend-deployers"
  ]
}
