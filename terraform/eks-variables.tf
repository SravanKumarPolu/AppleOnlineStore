variable "eks_admin_cidrs" {
  description = "Approved public CIDRs for the EKS API endpoint"
  type        = list(string)

  validation {
    condition = (
      length(var.eks_admin_cidrs) > 0 &&
      alltrue([
        for cidr in var.eks_admin_cidrs :
        can(cidrhost(cidr, 0)) &&
        cidr != "0.0.0.0/0" &&
        cidr != "::/0"
      ])
    )

    error_message = "Provide valid restricted CIDRs; open access is not allowed."
  }
}
