# Dedicated network access for an ephemeral EKS deployment worker.

resource "aws_security_group" "eks_deployment_worker" {
  name_prefix = "novacart-eks-deploy-worker-"
  description = "Temporary NovaCart EKS deployment worker"
  vpc_id      = aws_vpc.novacart.id

  tags = {
    Name = "novacart-eks-deploy-worker"
  }
}

# Worker can reach AWS service endpoints and install tools.
resource "aws_vpc_security_group_egress_rule" "eks_deployment_worker_https" {
  security_group_id = aws_security_group.eks_deployment_worker.id

  ip_protocol = "tcp"
  from_port   = 443
  to_port     = 443
  cidr_ipv4   = "0.0.0.0/0"

  description = "Outbound HTTPS for AWS services and EKS"
}

# Allow only the deployment worker to access the EKS private API.
resource "aws_vpc_security_group_ingress_rule" "eks_api_from_deployment_worker" {
  security_group_id = aws_eks_cluster.novacart.vpc_config[0].cluster_security_group_id

  referenced_security_group_id = aws_security_group.eks_deployment_worker.id

  ip_protocol = "tcp"
  from_port   = 443
  to_port     = 443

  description = "Private EKS API from NovaCart deployment worker"
}
