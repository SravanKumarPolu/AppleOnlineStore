# NovaCart Phase 4
# Dedicated IAM identity for temporary EKS deployment workers.

data "aws_iam_policy_document" "eks_deployment_worker_trust" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "eks_deployment_worker" {
  name               = "NovaCart-EKS-DeploymentWorkerRole"
  assume_role_policy = data.aws_iam_policy_document.eks_deployment_worker_trust.json

  tags = {
    Name = "novacart-eks-deployment-worker"
  }
}

# Allows the EC2 worker to register with AWS Systems Manager.
resource "aws_iam_role_policy_attachment" "eks_deployment_worker_ssm" {
  role       = aws_iam_role.eks_deployment_worker.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

# Only read cluster metadata. No permission to modify EKS resources.
resource "aws_iam_role_policy" "eks_deployment_worker_cluster_read" {
  name = "NovaCart-EKS-DeploymentWorker-DescribeCluster"
  role = aws_iam_role.eks_deployment_worker.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["eks:DescribeCluster"]
        Resource = aws_eks_cluster.novacart.arn
      }
    ]
  })
}

# EC2 uses this instance profile to receive temporary role credentials.
resource "aws_iam_instance_profile" "eks_deployment_worker" {
  name = "NovaCart-EKS-DeploymentWorkerProfile"
  role = aws_iam_role.eks_deployment_worker.name
}

# Map this IAM role to the existing backend-only Kubernetes RBAC group.
resource "aws_eks_access_entry" "eks_deployment_worker" {
  cluster_name      = aws_eks_cluster.novacart.name
  principal_arn     = aws_iam_role.eks_deployment_worker.arn
  type              = "STANDARD"
  kubernetes_groups = ["novacart-backend-deployers"]
}
