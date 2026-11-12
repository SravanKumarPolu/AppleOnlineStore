
# NovaCart Phase 4 — Amazon EKS IAM Roles
# Managed by the main Terraform configuration.

# ------------------------------------
# EKS Cluster Role
# ------------------------------------

data "aws_iam_policy_document" "eks_cluster_trust" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["eks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "eks_cluster" {
  name               = "NovaCart-EKS-ClusterRole"
  assume_role_policy = data.aws_iam_policy_document.eks_cluster_trust.json

  tags = {
    Name = "NovaCart-EKS-ClusterRole"
  }
}

resource "aws_iam_role_policy_attachment" "eks_cluster_policy" {
  role       = aws_iam_role.eks_cluster.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKSClusterPolicy"
}

# ------------------------------------
# EKS Managed Node Group Role
# ------------------------------------

data "aws_iam_policy_document" "eks_node_trust" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "eks_node" {
  name               = "NovaCart-EKS-NodeRole"
  assume_role_policy = data.aws_iam_policy_document.eks_node_trust.json

  tags = {
    Name = "NovaCart-EKS-NodeRole"
  }
}

resource "aws_iam_role_policy_attachment" "eks_worker_node_policy" {
  role       = aws_iam_role.eks_node.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKSWorkerNodePolicy"
}

resource "aws_iam_role_policy_attachment" "eks_ecr_pull_policy" {
  role       = aws_iam_role.eks_node.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryPullOnly"
}

