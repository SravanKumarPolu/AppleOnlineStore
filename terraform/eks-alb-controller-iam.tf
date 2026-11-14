# NovaCart Phase 4.3
# AWS Load Balancer Controller IAM configuration

data "aws_iam_policy_document" "alb_controller_trust" {
  statement {
    effect = "Allow"

    actions = [
      "sts:AssumeRole",
      "sts:TagSession"
    ]

    principals {
      type        = "Service"
      identifiers = ["pods.eks.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }
  }
}

resource "aws_iam_policy" "alb_controller" {
  name        = "AWSLoadBalancerControllerIAMPolicy"
  description = "NovaCart EKS AWS Load Balancer Controller permissions"

  policy = file(
    "${path.module}/iam-bootstrap/alb-controller/iam_policy.json"
  )

  tags = {
    Name        = "AWSLoadBalancerControllerIAMPolicy"
    Project     = "NovaCart"
    Environment = "dev"
  }
}

resource "aws_iam_role" "alb_controller" {
  name = "NovaCart-AWSLoadBalancerControllerRole"

  assume_role_policy = data.aws_iam_policy_document.alb_controller_trust.json

  tags = {
    Name        = "NovaCart-AWSLoadBalancerControllerRole"
    Project     = "NovaCart"
    Environment = "dev"
  }
}

resource "aws_iam_role_policy_attachment" "alb_controller" {
  role       = aws_iam_role.alb_controller.name
  policy_arn = aws_iam_policy.alb_controller.arn
}

resource "aws_eks_pod_identity_association" "alb_controller" {
  cluster_name    = aws_eks_cluster.novacart.name
  namespace       = "kube-system"
  service_account = "aws-load-balancer-controller"
  role_arn        = aws_iam_role.alb_controller.arn

  depends_on = [
    aws_iam_role_policy_attachment.alb_controller,
    aws_eks_addon.pod_identity_agent
  ]

  tags = {
    Project     = "NovaCart"
    Environment = "dev"
  }
}
