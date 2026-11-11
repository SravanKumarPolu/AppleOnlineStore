provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "NovaCart"
      Environment = var.environment
      ManagedBy   = "Terraform"
    }
  }
}
