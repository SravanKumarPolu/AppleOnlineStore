# Temporary CNI permissions for initial node bootstrap.
# Remove after Pod Identity is verified.

resource "aws_iam_role_policy_attachment" "eks_cni_bootstrap" {
  role       = aws_iam_role.eks_node.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKS_CNI_Policy"
}
