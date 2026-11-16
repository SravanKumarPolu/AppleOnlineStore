# GitHub Actions permissions for temporary NovaCart worker cleanup.
# Uses the existing main-branch-restricted GitHub EKS role.

resource "aws_iam_role_policy" "github_eks_worker_scheduler" {
  name = "novacart-eks-worker-scheduler"
  role = aws_iam_role.github_eks_deploy.id

  policy = jsonencode({
    Version = "2012-10-17"

    Statement = [
      {
        Sid    = "ManageNovaCartWorkerExpirySchedules"
        Effect = "Allow"

        Action = [
          "scheduler:CreateSchedule",
          "scheduler:GetSchedule",
          "scheduler:DeleteSchedule"
        ]

        Resource = "arn:aws:scheduler:us-east-1:942875993314:schedule/default/novacart-worker-expiry-*"
      },
      {
        Sid    = "PassOnlyWorkerCleanupSchedulerRole"
        Effect = "Allow"

        Action = "iam:PassRole"

        Resource = "arn:aws:iam::942875993314:role/NovaCart-EKS-WorkerCleanupSchedulerRole"

        Condition = {
          StringEquals = {
            "iam:PassedToService" = "scheduler.amazonaws.com"
          }
        }
      }
    ]
  })
}
