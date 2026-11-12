# NovaCart Phase 4 - Amazon EKS Cluster

resource "aws_eks_cluster" "novacart" {
  name     = "novacart-dev-eks"
  role_arn = aws_iam_role.eks_cluster.arn
  version  = "1.37"

  access_config {
    authentication_mode                         = "API_AND_CONFIG_MAP"
    bootstrap_cluster_creator_admin_permissions = true
  }

  vpc_config {
    subnet_ids = [
      aws_subnet.public_a.id,
      aws_subnet.public_b.id
    ]

    endpoint_private_access = true
    endpoint_public_access  = true

    public_access_cidrs = var.eks_admin_cidrs
  }

  tags = {
    Name = "novacart-dev-eks"
  }

  depends_on = [
    aws_iam_role_policy_attachment.eks_cluster_policy
  ]
}
