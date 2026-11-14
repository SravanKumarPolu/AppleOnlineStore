provider "aws" {
  region = "us-east-1"

  default_tags {
    tags = {
      Project     = "NovaCart"
      Environment = "dev"
      ManagedBy   = "Terraform"
    }
  }
}
