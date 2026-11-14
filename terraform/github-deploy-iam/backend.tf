terraform {
  backend "s3" {
    bucket       = "novacart-terraform-state-942875993314"
    key          = "novacart/dev/github-deploy-iam/terraform.tfstate"
    region       = "us-east-1"
    encrypt      = true
    use_lockfile = true
  }
}
