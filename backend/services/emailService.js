import nodemailer from 'nodemailer';
import path from 'path';
import { promises as fs } from 'fs';
import { fileURLToPath } from 'url';

const getSmtpFailureCategory = (error) => {
  if (error?.code === 'EMAIL_TRANSPORT_UNAVAILABLE') return 'configuration unavailable';
  if (error?.code === 'EAUTH' || [534, 535].includes(Number(error?.responseCode))) {
    return 'authentication rejected';
  }
  if (
    ['ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT', 'ECONNECTION', 'EHOSTUNREACH', 'ENETUNREACH', 'ESOCKET'].includes(
      error?.code
    )
  ) {
    return 'network connection failed';
  }
  return 'SMTP operation failed';
};

// Get __dirname equivalent for ES6 modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class EmailService {
  constructor() {
    this.transporter = null;
    this.templates = {};
    this.transportReady = this.initializeTransporter();
    this.templatesReady = this.loadTemplates();
  }

  async initializeTransporter() {
    try {
      const host = process.env.SMTP_HOST?.trim();
      const user = process.env.SMTP_USER?.trim();
      const pass = process.env.SMTP_PASS;
      const configuredPort = process.env.SMTP_PORT?.trim();
      const port = configuredPort ? Number(configuredPort) : 587;

      if (!host || !user || !pass?.trim() || !Number.isInteger(port) || port < 1 || port > 65535) {
        this.transporter = null;
        console.error('❌ Email service initialization failed: SMTP configuration is missing or invalid');
        return false;
      }

      const config = {
        host,
        port,
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
          user,
          pass
        },
        tls: {
          // Certificate validation is ON by default. Operators with a
          // self-signed relay can explicitly opt out via SMTP_ALLOW_SELF_SIGNED=true.
          rejectUnauthorized: process.env.SMTP_ALLOW_SELF_SIGNED !== 'true'
        }
      };

      const transporter = nodemailer.createTransport(config);
      await transporter.verify();
      this.transporter = transporter;
      console.log('✅ Email service initialized successfully');
      return true;
    } catch (error) {
      console.error(`❌ Email service initialization failed: ${getSmtpFailureCategory(error)}`);
      this.transporter = null;
      return false;
    }
  }

  async loadTemplates() {
    try {
      const templatesDir = path.join(__dirname, '../templates/email');
      const templateFiles = await fs.readdir(templatesDir);
      
      for (const file of templateFiles) {
        if (file.endsWith('.html')) {
          const templateName = path.basename(file, '.html');
          const templatePath = path.join(templatesDir, file);
          const templateContent = await fs.readFile(templatePath, 'utf-8');
          this.templates[templateName] = templateContent;
        }
      }
      console.log('✅ Email templates loaded successfully');

      // The templates/email directory exists but only partially shipped
      // (passwordReset.html alone). Fill any missing template keys from the
      // built-in fallbacks so every send*Email method can actually render;
      // on-disk files always take precedence over the fallbacks.
      const fallbacks = this.getFallbackTemplates();
      for (const [name, content] of Object.entries(fallbacks)) {
        if (!this.templates[name]) {
          this.templates[name] = content;
        }
      }
    } catch (error) {
      console.error('❌ Failed to load email templates:', error.message);
      // Use fallback templates
      this.createFallbackTemplates();
    }
  }

  getFallbackTemplates() {
    return {
      passwordReset: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>Password Reset</title>
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
          <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #2563eb;">Password Reset Request</h2>
            <p>Hello {{name}},</p>
            <p>You requested a password reset for your account. Click the button below to reset your password:</p>
            <div style="text-align: center; margin: 30px 0;">
              <a href="{{resetLink}}" style="background-color: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">Reset Password</a>
            </div>
            <p>This link will expire in 1 hour for security reasons.</p>
            <p>If you didn't request this reset, please ignore this email.</p>
            <hr style="margin: 30px 0; border: none; border-top: 1px solid #eee;">
            <p style="font-size: 12px; color: #666;">This is an automated message, please do not reply.</p>
          </div>
        </body>
        </html>
      `,
      welcome: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>Welcome to {{appName}}</title>
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
          <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #2563eb;">Welcome to {{appName}}!</h2>
            <p>Hello {{name}},</p>
            <p>Thank you for creating an account with us. We're excited to have you as part of our community!</p>
            <p>You can now:</p>
            <ul>
              <li>Browse our products</li>
              <li>Create wishlists</li>
              <li>Track your orders</li>
              <li>Manage your profile</li>
            </ul>
            <div style="text-align: center; margin: 30px 0;">
              <a href="{{loginLink}}" style="background-color: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">Start Shopping</a>
            </div>
            <hr style="margin: 30px 0; border: none; border-top: 1px solid #eee;">
            <p style="font-size: 12px; color: #666;">This is an automated message, please do not reply.</p>
          </div>
        </body>
        </html>
      `,
      orderConfirmation: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>Order Confirmation</title>
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
          <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #2563eb;">Order Confirmation</h2>
            <p>Hello {{name}},</p>
            <p>Thank you for your order! Here are your order details:</p>
            <div style="background-color: #f8fafc; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <h3>Order #{{orderId}}</h3>
              <p><strong>Order Date:</strong> {{orderDate}}</p>
              <p><strong>Total Amount:</strong> \${{totalAmount}}</p>
              <p><strong>Status:</strong> {{orderStatus}}</p>
            </div>
            <div style="text-align: center; margin: 30px 0;">
              <a href="{{orderLink}}" style="background-color: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">View Order</a>
            </div>
            <hr style="margin: 30px 0; border: none; border-top: 1px solid #eee;">
            <p style="font-size: 12px; color: #666;">This is an automated message, please do not reply.</p>
          </div>
        </body>
        </html>
      `,
      orderStatusUpdate: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>Order Status Update</title>
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
          <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #2563eb;">Order Status Update</h2>
            <p>Hello {{name}},</p>
            <p>{{statusMessage}}</p>
            <div style="background-color: #f8fafc; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <h3>Order #{{orderId}}</h3>
              <p><strong>Status:</strong> {{orderStatus}}</p>
            </div>
            <div style="text-align: center; margin: 30px 0;">
              <a href="{{orderLink}}" style="background-color: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">View Order</a>
            </div>
            <hr style="margin: 30px 0; border: none; border-top: 1px solid #eee;">
            <p style="font-size: 12px; color: #666;">This is an automated message, please do not reply.</p>
          </div>
        </body>
        </html>
      `,
      lowStockAlert: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>Low Stock Alert</title>
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
          <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #dc2626;">Low Stock Alert</h2>
            <p>A product is running low on stock and may need restocking:</p>
            <div style="background-color: #f8fafc; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <h3>{{productName}}</h3>
              <p><strong>Product ID:</strong> {{productId}}</p>
              <p><strong>Current Stock:</strong> {{currentStock}}</p>
            </div>
            <p>Please review inventory and restock as needed.</p>
          </div>
        </body>
        </html>
      `,
      securityAlert: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>Security Alert</title>
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
          <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #dc2626;">Security Alert</h2>
            <p>Hello {{name}},</p>
            <p>We detected unusual activity on your account:</p>
            <div style="background-color: #fef2f2; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <p><strong>Alert Type:</strong> {{alertType}}</p>
              <p><strong>Details:</strong> {{details}}</p>
              <p><strong>Time:</strong> {{timestamp}}</p>
            </div>
            <p>If this was not you, please reset your password immediately and contact support.</p>
          </div>
        </body>
        </html>
      `
    };
  }

  createFallbackTemplates() {
    this.templates = this.getFallbackTemplates();
  }

  replaceTemplateVariables(template, variables) {
    let result = template;
    for (const [key, value] of Object.entries(variables)) {
      const regex = new RegExp(`{{${key}}}`, 'g');
      result = result.replace(regex, value);
    }
    return result;
  }

  async sendEmail(options) {
    const {
      to,
      subject,
      template,
      variables = {},
      attachments = [],
      cc,
      bcc
    } = options;

    try {
      await Promise.all([this.transportReady, this.templatesReady]);
      if (!this.transporter) {
        const error = new Error('Email transport is unavailable');
        error.code = 'EMAIL_TRANSPORT_UNAVAILABLE';
        throw error;
      }

      // Get template content
      const templateContent = this.templates[template];
      if (!templateContent) {
        throw new Error(`Template '${template}' not found`);
      }

      // Replace variables in template
      const htmlContent = this.replaceTemplateVariables(templateContent, {
        appName: process.env.APP_NAME || 'E-commerce Store',
        ...variables
      });

      const mailOptions = {
        from: `"${process.env.EMAIL_FROM_NAME || 'E-commerce Store'}" <${process.env.EMAIL_FROM || process.env.SMTP_USER}>`,
        to,
        subject,
        html: htmlContent,
        attachments,
        cc,
        bcc
      };

      const result = await this.transporter.sendMail(mailOptions);
      console.log('✅ Email accepted by SMTP');
      return result;
    } catch (error) {
      console.error(`❌ Failed to send email: ${getSmtpFailureCategory(error)}`);
      throw error;
    }
  }

  async sendPasswordResetEmail(email, name, resetToken) {
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const resetUrl = new URL('/reset-password', frontendUrl);
    resetUrl.searchParams.set('token', resetToken);
    const resetLink = resetUrl.toString();
    
    return this.sendEmail({
      to: email,
      subject: 'Password Reset Request',
      template: 'passwordReset',
      variables: {
        name,
        resetLink
      }
    });
  }

  async sendWelcomeEmail(email, name) {
    const loginLink = `${process.env.FRONTEND_URL}/login`;
    
    return this.sendEmail({
      to: email,
      subject: 'Welcome to Our Store!',
      template: 'welcome',
      variables: {
        name,
        loginLink
      }
    });
  }

  async sendOrderConfirmationEmail(email, name, orderData) {
    const orderLink = `${process.env.FRONTEND_URL}/orders/${orderData.orderId}`;
    
    return this.sendEmail({
      to: email,
      subject: `Order Confirmation #${orderData.orderId}`,
      template: 'orderConfirmation',
      variables: {
        name,
        orderId: orderData.orderId,
        orderDate: new Date(orderData.createdAt).toLocaleDateString(),
        totalAmount: orderData.totalAmount.toFixed(2),
        orderStatus: orderData.status,
        orderLink
      }
    });
  }

  async sendOrderStatusUpdateEmail(email, name, orderData) {
    const orderLink = `${process.env.FRONTEND_URL}/orders/${orderData.orderId}`;
    
    return this.sendEmail({
      to: email,
      subject: `Order Status Update #${orderData.orderId}`,
      template: 'orderStatusUpdate',
      variables: {
        name,
        orderId: orderData.orderId,
        orderStatus: orderData.status,
        orderLink,
        statusMessage: this.getStatusMessage(orderData.status)
      }
    });
  }

  getStatusMessage(status) {
    const statusMessages = {
      'processing': 'Your order is being processed and will be shipped soon.',
      'shipped': 'Your order has been shipped and is on its way to you.',
      'delivered': 'Your order has been delivered successfully.',
      'cancelled': 'Your order has been cancelled as requested.',
      'refunded': 'Your order has been refunded.'
    };
    return statusMessages[status] || 'Your order status has been updated.';
  }

  async sendLowStockAlertEmail(productData) {
    return this.sendEmail({
      to: process.env.ADMIN_EMAIL,
      subject: 'Low Stock Alert',
      template: 'lowStockAlert',
      variables: {
        productName: productData.name,
        currentStock: productData.stock,
        productId: productData._id
      }
    });
  }

  async sendSecurityAlertEmail(email, name, alertType, details) {
    return this.sendEmail({
      to: email,
      subject: 'Security Alert',
      template: 'securityAlert',
      variables: {
        name,
        alertType,
        details,
        timestamp: new Date().toLocaleString()
      }
    });
  }

  // Test email functionality
  async testConnection() {
    try {
      await this.transporter.verify();
      return { success: true, message: 'Email service is working correctly' };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  // Get email service status
  getStatus() {
    return {
      initialized: !!this.transporter,
      host: process.env.SMTP_HOST,
      port: process.env.SMTP_PORT,
      user: process.env.SMTP_USER,
      templatesLoaded: Object.keys(this.templates).length
    };
  }
}

// Create singleton instance
const emailService = new EmailService();

export default emailService; 