# Allow the temporary EC2 deployment worker to verify backend image tags.

resource "aws_iam_role_policy" "eks_deployment_worker_ecr_read" {
  name = "NovaCart-EKS-DeploymentWorker-ECR-Describe"
  role = aws_iam_role.eks_deployment_worker.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "DescribeNovaCartBackendImages"
        Effect   = "Allow"
        Action   = ["ecr:DescribeImages"]
        Resource = "arn:aws:ecr:us-east-1:942875993314:repository/novacart/backend"
      }
    ]
  })
}
