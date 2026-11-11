# NovaCart Internet Gateway
resource "aws_internet_gateway" "novacart" {
  vpc_id = aws_vpc.novacart.id

  tags = {
    Name = "novacart-dev-igw"
  }
}

# Public Route Table
resource "aws_route_table" "public" {
  vpc_id = aws_vpc.novacart.id

  tags = {
    Name = "novacart-public-rt"
  }
}

# Internet Route
resource "aws_route" "public_internet" {
  route_table_id         = aws_route_table.public.id
  destination_cidr_block = "0.0.0.0/0"
  gateway_id             = aws_internet_gateway.novacart.id
}

# Public Subnet A Association
resource "aws_route_table_association" "public_a" {
  subnet_id      = aws_subnet.public_a.id
  route_table_id = aws_route_table.public.id
}

# Public Subnet B Association
resource "aws_route_table_association" "public_b" {
  subnet_id      = aws_subnet.public_b.id
  route_table_id = aws_route_table.public.id
}
