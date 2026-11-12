# IAM trust policy for EKS Pod Identity

data "aws_iam_policy_document" "eks_cni_trust" {
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

data "aws_caller_identity" "current" {}

resource "aws_iam_role" "eks_cni" {
  name               = "NovaCart-EKS-CNIRole"
  assume_role_policy = data.aws_iam_policy_document.eks_cni_trust.json

  tags = {
    Name = "NovaCart-EKS-CNIRole"
  }
}

resource "aws_iam_role_policy_attachment" "eks_cni_policy" {
  role       = aws_iam_role.eks_cni.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKS_CNI_Policy"
}
