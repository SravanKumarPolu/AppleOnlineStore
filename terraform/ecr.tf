
# NovaCart Phase 4.7
# Amazon ECR backend container repository
# Configuration only — do not apply yet.

resource "aws_ecr_repository" "backend" {
  name                 = "novacart/backend"
  image_tag_mutability = "IMMUTABLE"
  force_delete         = false

  encryption_configuration {
    encryption_type = "AES256"
  }

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = {
    Name = "novacart-dev-backend-ecr"
  }
}

# Keep up to 10 backend container images.
# Older images become eligible for expiration.

resource "aws_ecr_lifecycle_policy" "backend" {
  repository = aws_ecr_repository.backend.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Retain latest 10 images"

        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = 10
        }

        action = {
          type = "expire"
        }
      }
    ]
  })
}
