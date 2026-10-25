# PayPal Integration Setup Guide

## Backend Configuration

### 1. Environment Variables
Create a `.env` file in the `backend` directory with the following variables:

```env
# PayPal Configuration
PAYPAL_CLIENT_ID=AbOtiWHzUtnR9K6vDyyfTHQw0px-yRPwUngXPDoN7HbRZSkyMR65KNCvNEqvEldeouNwTwRKihtu1pCl
PAYPAL_CLIENT_SECRET=your_paypal_client_secret

# Environment
NODE_ENV=development

# Frontend URL (for PayPal return URLs)
FRONTEND_URL=http://localhost:5173

# JWT Secret (for authentication)
JWT_SECRET=your_jwt_secret_here

# MongoDB Connection
MONGODB_URI=your_mongodb_connection_string
```

### 2. PayPal SDK
The PayPal SDK is already installed in the backend:
```bash
npm install @paypal/checkout-server-sdk
```

## Frontend Configuration

### 1. PayPal React SDK
The PayPal React SDK is already installed in the frontend:
```bash
npm install @paypal/react-paypal-js
```

### 2. Client ID
The PayPal client ID is configured in the `PayPalPayment.tsx` component.

## Database Integration

### 1. Order Model
A comprehensive Order model has been created (`backend/models/orderModel.js`) that includes:
- User association
- Order items with product details
- Shipping address
- Payment information (PayPal transaction IDs, etc.)
- Order and payment status tracking
- Timestamps and metadata

### 2. Database Schema
The order schema supports:
- **Order Items**: Product ID, name, image, price, quantity, color
- **Address**: Complete shipping address information
- **Payment Details**: Method, status, PayPal transaction IDs
- **Order Status**: Order Placed, Packing, Shipped, Out for delivery, Delivered, Cancelled
- **Payment Status**: pending, completed, failed, refunded

## Features Implemented

### Backend Features:
1. **PayPal Order Creation** (`/api/orders/paypal/create`)
   - Creates PayPal orders with item details
   - Handles shipping address
   - Saves order to database with PayPal order ID
   - Returns PayPal order ID and links

2. **Payment Capture** (`/api/orders/paypal/capture`)
   - Captures payments after user approval
   - Updates order status in database
   - Clears user's cart after successful payment
   - Returns payment confirmation with order details

3. **Webhook Handling** (`/api/orders/paypal/webhook`)
   - Handles PayPal webhook events
   - Processes payment completions, refunds, and denials
   - Updates order status based on events

4. **User Orders** (`/api/orders/userorders`)
   - Retrieves user's order history
   - Supports pagination and status filtering
   - Returns complete order details

5. **Admin Order Management** (`/api/orders/list`, `/api/orders/status`)
   - Admin can view all orders
   - Update order and payment status
   - Filter orders by status

### Frontend Features:
1. **PayPal Payment Component**
   - Integrates PayPal buttons
   - Handles payment flow with authentication
   - Shows loading states and error handling

2. **Payment Method Selection**
   - Added PayPal to payment methods
   - PayPal logo and branding
   - Seamless integration with existing checkout

3. **Order History Page** (`/orders`)
   - Displays user's complete order history
   - Shows order status, payment status, and details
   - Supports filtering by order status
   - Pagination for large order lists

4. **Order Flow**
   - Address validation before payment
   - PayPal payment processing
   - Automatic redirect to order history after success
   - Cart clearing after successful payment

## Authentication & Security

### 1. User Authentication
- All order operations require user authentication
- JWT token validation for all order endpoints
- User-specific order access and management

### 2. Admin Authentication
- Admin-only endpoints for order management
- Role-based access control
- Secure order status updates

### 3. Data Protection
- User orders are isolated by user ID
- Sensitive payment data is stored securely
- Webhook signature verification (recommended for production)

## Usage

1. **Select PayPal as payment method** in the checkout page
2. **Fill in delivery address** (required for PayPal)
3. **Click "PLACE ORDER"** to proceed to PayPal
4. **Complete payment** through PayPal interface
5. **Automatically redirected** to order history page
6. **View order details** including status and payment information

## Order Management

### User Features:
- View complete order history
- Track order status
- See payment confirmation details
- Filter orders by status

### Admin Features:
- View all orders across users
- Update order status
- Update payment status
- Filter and search orders

## Webhook Events Handled

- `PAYMENT.SALE.COMPLETED` - Payment successful
- `PAYMENT.SALE.REFUNDED` - Payment refunded
- `PAYMENT.SALE.DENIED` - Payment denied

## Database Operations

### Order Creation:
- Saves order with PayPal order ID
- Associates order with authenticated user
- Stores complete item and address information

### Payment Capture:
- Updates order with PayPal capture ID
- Sets payment status to completed
- Clears user's cart automatically

### Webhook Processing:
- Updates order status based on PayPal events
- Maintains payment transaction history
- Logs all payment status changes

## Security Notes

1. **Environment Variables**: Never commit PayPal credentials to version control
2. **Webhook Verification**: Implement webhook signature verification for production
3. **HTTPS**: Use HTTPS in production for secure communication
4. **Error Handling**: Comprehensive error handling for payment failures
5. **Authentication**: All order operations require valid user authentication
6. **Data Validation**: Input validation for all order data

## Testing

### Sandbox Mode
- Uses PayPal sandbox environment for testing
- Test with PayPal sandbox accounts
- No real money transactions
- Database stores test orders

### Production Mode
- Set `NODE_ENV=production` for live environment
- Use real PayPal business account credentials
- Enable webhook signature verification
- Real money transactions and order storage

## Troubleshooting

1. **PayPal Button Not Loading**: Check client ID configuration
2. **Order Creation Fails**: Verify backend environment variables and database connection
3. **Payment Capture Fails**: Check PayPal account status and permissions
4. **Webhook Not Working**: Verify webhook URL and signature verification
5. **Authentication Errors**: Ensure user is logged in and token is valid
6. **Database Errors**: Check MongoDB connection and schema validation

## Next Steps

1. **Order Notifications**: Implement email notifications for order status changes
2. **Refund Handling**: Add refund functionality with PayPal integration
3. **Analytics**: Track payment success rates and user behavior
4. **Order Tracking**: Add shipment tracking integration
5. **Inventory Management**: Connect orders to inventory system
6. **Reporting**: Add admin reporting and analytics dashboard 