output "github_deploy_role_arn" {
  description = "IAM role ARN for NovaCart GitHub Actions"
  value       = aws_iam_role.github_deploy.arn
}

output "github_oidc_provider_arn" {
  description = "AWS GitHub OIDC identity provider ARN"
  value       = aws_iam_openid_connect_provider.github.arn
}
