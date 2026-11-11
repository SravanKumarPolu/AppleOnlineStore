
# NovaCart Phase 4.6.5
# GitHub OIDC authentication design
# Do not terraform apply yet.

# GitHub's OIDC identity provider
resource "aws_iam_openid_connect_provider" "github" {
  url = "https://token.actions.githubusercontent.com"

  client_id_list = [
    "sts.amazonaws.com"
  ]

  tags = {
    Name = "novacart-github-oidc"
  }
}

# Role trust policy
data "aws_iam_policy_document" "github_deploy_trust" {
  statement {
    sid     = "GitHubMainBranchOnly"
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type = "Federated"
      identifiers = [
        aws_iam_openid_connect_provider.github.arn
      ]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }


    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values = [
        "repo:SravanKumarPolu@99873642/AppleOnlineStore@1433466945:ref:refs/heads/main"
      ]
    }

  }
}

# Deployment role
resource "aws_iam_role" "github_deploy" {
  name = "novacart-dev-github-deploy-role"

  assume_role_policy = (
    data.aws_iam_policy_document.github_deploy_trust.json
  )

  max_session_duration = 3600

  tags = {
    Name = "novacart-dev-github-deploy-role"
  }
}
