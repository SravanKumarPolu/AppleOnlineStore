output "eks_cluster_name" {
  description = "NovaCart EKS cluster name"
  value       = aws_eks_cluster.novacart.name
}

output "eks_cluster_endpoint" {
  description = "NovaCart Kubernetes API endpoint"
  value       = aws_eks_cluster.novacart.endpoint
}

output "eks_cluster_security_group_id" {
  description = "EKS-created cluster security group"
  value       = aws_eks_cluster.novacart.vpc_config[0].cluster_security_group_id
}
