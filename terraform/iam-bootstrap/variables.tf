variable "aws_region" {
  description = "AWS region for NovaCart"
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "NovaCart deployment environment"
  type        = string
  default     = "dev"
}