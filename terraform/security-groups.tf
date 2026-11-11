# Phase 4.5 - Security Groups

# Future public-facing Application Load Balancer
resource "aws_security_group" "alb" {
  name        = "novacart-dev-alb-sg"
  description = "Security group for future NovaCart ALB"
  vpc_id      = aws_vpc.novacart.id

  tags = {
    Name = "novacart-dev-alb-sg"
  }
}

# Future Node.js backend
resource "aws_security_group" "backend" {
  name        = "novacart-dev-backend-sg"
  description = "Security group for NovaCart backend"
  vpc_id      = aws_vpc.novacart.id

  tags = {
    Name = "novacart-dev-backend-sg"
  }
}

# Public HTTPS access to the ALB
resource "aws_vpc_security_group_ingress_rule" "alb_https" {
  security_group_id = aws_security_group.alb.id
  description       = "HTTPS from internet"
  cidr_ipv4         = "0.0.0.0/0"
  from_port         = 443
  to_port           = 443
  ip_protocol       = "tcp"
}

# ALB can connect to the backend on port 3001
resource "aws_vpc_security_group_egress_rule" "alb_to_backend" {
  security_group_id            = aws_security_group.alb.id
  description                  = "ALB to NovaCart backend"
  referenced_security_group_id = aws_security_group.backend.id
  from_port                    = 3001
  to_port                      = 3001
  ip_protocol                  = "tcp"
}

# Backend only accepts port 3001 from the ALB
resource "aws_vpc_security_group_ingress_rule" "backend_from_alb" {
  security_group_id            = aws_security_group.backend.id
  description                  = "Backend API from ALB"
  referenced_security_group_id = aws_security_group.alb.id
  from_port                    = 3001
  to_port                      = 3001
  ip_protocol                  = "tcp"
}
