
# Temporary healthy node group for safe workload migration.
# Do not modify the existing aws_eks_node_group.novacart.

resource "aws_eks_node_group" "recovery" {
  cluster_name    = aws_eks_cluster.novacart.name
  node_group_name = "novacart-dev-nodes-recovery"
  node_role_arn   = aws_iam_role.eks_node.arn

  subnet_ids = [
    aws_subnet.public_a.id,
    aws_subnet.public_b.id
  ]

  instance_types = ["m7i-flex.large"]
  ami_type       = "AL2023_x86_64_STANDARD"
  capacity_type  = "ON_DEMAND"
  disk_size      = 30

  scaling_config {
    desired_size = 1
    min_size     = 1
    max_size     = 1
  }

  update_config {
    max_unavailable = 1
  }

  tags = {
    Name = "novacart-dev-nodes-recovery"
  }

  depends_on = [
    aws_iam_role_policy_attachment.eks_worker_node_policy,
    aws_iam_role_policy_attachment.eks_ecr_pull_policy,
    aws_eks_addon.vpc_cni
  ]
}
