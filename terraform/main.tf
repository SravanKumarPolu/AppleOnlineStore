
# NovaCart VPC
resource "aws_vpc" "novacart" {
  cidr_block           = "10.20.0.0/16"
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = {
    Name = "novacart-dev-vpc"
  }
}

# Public Subnet A
resource "aws_subnet" "public_a" {
  vpc_id            = aws_vpc.novacart.id
  cidr_block        = "10.20.1.0/24"
  availability_zone = "us-east-1a"

  map_public_ip_on_launch = false

  tags = {
    Name = "novacart-public-a"
  }
}

# Public Subnet B
resource "aws_subnet" "public_b" {
  vpc_id            = aws_vpc.novacart.id
  cidr_block        = "10.20.2.0/24"
  availability_zone = "us-east-1b"

  map_public_ip_on_launch = false

  tags = {
    Name = "novacart-public-b"
  }
}

# Private Subnet A
resource "aws_subnet" "private_a" {
  vpc_id            = aws_vpc.novacart.id
  cidr_block        = "10.20.11.0/24"
  availability_zone = "us-east-1a"

  tags = {
    Name = "novacart-private-a"
  }
}

# Private Subnet B
resource "aws_subnet" "private_b" {
  vpc_id            = aws_vpc.novacart.id
  cidr_block        = "10.20.12.0/24"
  availability_zone = "us-east-1b"

  tags = {
    Name = "novacart-private-b"
  }
}
