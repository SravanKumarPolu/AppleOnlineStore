
# NovaCart Phase 4.8.1
# Amazon ECS cluster configuration

resource "aws_ecs_cluster" "novacart" {
  name = "novacart-dev-cluster"

  setting {
    name  = "containerInsights"
    value = "disabled"
  }

  tags = {
    Name = "novacart-dev-cluster"
  }
}

