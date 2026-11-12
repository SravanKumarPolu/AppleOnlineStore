# NovaCart Phase 4 - EKS Managed Add-ons

resource "aws_eks_addon" "vpc_cni" {
  cluster_name  = aws_eks_cluster.novacart.name
  addon_name    = "vpc-cni"
  addon_version = "v1.22.4-eksbuild.14"

  resolve_conflicts_on_create = "OVERWRITE"

  pod_identity_association {
    service_account = "aws-node"
    role_arn        = aws_iam_role.eks_cni.arn
  }

  depends_on = [
    aws_iam_role_policy_attachment.eks_cni_policy
  ]
}



resource "aws_eks_addon" "coredns" {
  cluster_name  = aws_eks_cluster.novacart.name
  addon_name    = "coredns"
  addon_version = "v1.14.7-eksbuild.35"

  resolve_conflicts_on_create = "OVERWRITE"

  depends_on = [
    aws_eks_node_group.novacart
  ]
}


resource "aws_eks_addon" "kube_proxy" {
  cluster_name  = aws_eks_cluster.novacart.name
  addon_name    = "kube-proxy"
  addon_version = "v1.37.0-eksbuild.39"

  resolve_conflicts_on_create = "OVERWRITE"
}

resource "aws_eks_addon" "pod_identity_agent" {
  cluster_name  = aws_eks_cluster.novacart.name
  addon_name    = "eks-pod-identity-agent"
  addon_version = "v1.4.1-eksbuild.3"
}
