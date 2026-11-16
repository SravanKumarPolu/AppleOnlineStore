# Restricted GitHub Actions EC2 worker lifecycle permissions.

resource "aws_iam_role_policy" "github_eks_worker_ec2" {
  name = "novacart-eks-worker-ec2"
  role = aws_iam_role.github_eks_deploy.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "UseApprovedWorkerInfrastructure"
        Effect = "Allow"
        Action = "ec2:RunInstances"
        Resource = [
          "arn:aws:ec2:us-east-1::image/ami-096ef200a877f36af",
          "arn:aws:ec2:us-east-1:942875993314:subnet/subnet-0d6acd94e5822fc09",
          "arn:aws:ec2:us-east-1:942875993314:security-group/sg-0d442aff54a847834",
          "arn:aws:ec2:us-east-1:942875993314:network-interface/*"
        ]
      },
      {
        Sid      = "LaunchOnlyTaggedSmallWorkers"
        Effect   = "Allow"
        Action   = "ec2:RunInstances"
        Resource = "arn:aws:ec2:us-east-1:942875993314:instance/*"
        Condition = {
          StringEquals = {
            "ec2:InstanceType"               = "t3.small"
            "ec2:InstanceProfile"            = "arn:aws:iam::942875993314:instance-profile/NovaCart-EKS-DeploymentWorkerProfile"
            "aws:RequestTag/NovaCartPurpose" = "eks-deployment-worker"
            "aws:RequestTag/ManagedBy"       = "github-automation"
            "ec2:MetadataHttpTokens"         = "required"
          }
        }
      },
      {
        Sid      = "CreateWorkerRootVolume"
        Effect   = "Allow"
        Action   = "ec2:RunInstances"
        Resource = "arn:aws:ec2:us-east-1:942875993314:volume/*"
      },
      {
        Sid    = "TagOnlyDuringWorkerCreation"
        Effect = "Allow"
        Action = "ec2:CreateTags"
        Resource = [
          "arn:aws:ec2:us-east-1:942875993314:instance/*",
          "arn:aws:ec2:us-east-1:942875993314:volume/*"
        ]
        Condition = {
          StringEquals = {
            "ec2:CreateAction"               = "RunInstances"
            "aws:RequestTag/NovaCartPurpose" = "eks-deployment-worker"
            "aws:RequestTag/ManagedBy"       = "github-automation"
          }
        }
      },
      {
        Sid      = "DescribeInstancesForWorkerLifecycle"
        Effect   = "Allow"
        Action   = "ec2:DescribeInstances"
        Resource = "*"
      },
      {
        Sid      = "TerminateOnlyTaggedWorkers"
        Effect   = "Allow"
        Action   = "ec2:TerminateInstances"
        Resource = "arn:aws:ec2:us-east-1:942875993314:instance/*"
        Condition = {
          StringEquals = {
            "aws:ResourceTag/NovaCartPurpose" = "eks-deployment-worker"
            "aws:ResourceTag/ManagedBy"       = "github-automation"
          }
        }
      },
      {
        Sid      = "PassOnlyDeploymentWorkerRole"
        Effect   = "Allow"
        Action   = "iam:PassRole"
        Resource = "arn:aws:iam::942875993314:role/NovaCart-EKS-DeploymentWorkerRole"
        Condition = {
          StringEquals = {
            "iam:PassedToService" = "ec2.amazonaws.com"
          }
        }
      }
    ]
  })
}
