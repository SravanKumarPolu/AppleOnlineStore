# GitHub Actions SSM access to temporary NovaCart deployment workers.

resource "aws_iam_role_policy" "github_eks_worker_ssm" {
  name = "novacart-eks-worker-ssm"
  role = aws_iam_role.github_eks_deploy.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "UseApprovedShellDocument"
        Effect   = "Allow"
        Action   = "ssm:SendCommand"
        Resource = "arn:aws:ssm:us-east-1::document/AWS-RunShellScript"
      },
      {
        Sid      = "SendCommandsOnlyToNovaCartWorkers"
        Effect   = "Allow"
        Action   = "ssm:SendCommand"
        Resource = "arn:aws:ec2:us-east-1:942875993314:instance/*"

        Condition = {
          StringEquals = {
            "ssm:resourceTag/NovaCartPurpose" = "eks-deployment-worker"
            "ssm:resourceTag/ManagedBy"       = "github-automation"
          }
        }
      },
      {
        Sid    = "InspectSSMWorkerStatus"
        Effect = "Allow"
        Action = [
          "ssm:DescribeInstanceInformation",
          "ssm:ListCommands",
          "ssm:ListCommandInvocations"
        ]
        Resource = "*"
      },
      {
        Sid      = "ReadSSMCommandResults"
        Effect   = "Allow"
        Action   = "ssm:GetCommandInvocation"
        Resource = "*"
      }
    ]
  })
}
