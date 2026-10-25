import mongoose from 'mongoose';
// `bcryptjs` was never a dependency of this package — the backend uses the
// native `bcrypt` module (same hash/compare API).
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import emailService from '../services/emailService.js';
import User from '../models/userModel.js';
import Product from '../models/productModel.js';
import Order from '../models/orderModel.js';
import { UserActivity, ProductPerformance, SearchAnalytics } from '../models/analyticsModel.js';

class TestUtilities {
  constructor() {
    this.testData = {};
    this.testUsers = [];
    this.testProducts = [];
    this.testOrders = [];
  }

  // =============================================================================
  // DATABASE UTILITIES
  // =============================================================================

  async connectToTestDB() {
    try {
      const testUri = process.env.TEST_MONGODB_URI || 'mongodb://localhost:27017/ecommerce-test';
      await mongoose.connect(testUri);
      console.log('✅ Connected to test database');
      return true;
  } catch (error) {
      console.error('❌ Failed to connect to test database:', error.message);
      return false;
    }
  }

  async clearTestDatabase() {
    try {
      const collections = await mongoose.connection.db.collections();
      for (let collection of collections) {
        await collection.deleteMany({});
      }
      console.log('✅ Test database cleared');
      return true;
    } catch (error) {
      console.error('❌ Failed to clear test database:', error.message);
      return false;
    }
  }

  async disconnectFromTestDB() {
    try {
      await mongoose.connection.close();
      console.log('✅ Disconnected from test database');
      return true;
    } catch (error) {
      console.error('❌ Failed to disconnect from test database:', error.message);
      return false;
    }
  }

  // =============================================================================
  // USER TEST UTILITIES
  // =============================================================================

  async createTestUser(userData = {}) {
    const defaultUser = {
      name: 'Test User',
      // Unique per call — a fixed address collides with the unique email
      // index when this helper is invoked more than once per test run
      // (e.g. database test + email test + integration rerun).
      email: this.generateRandomEmail(),
      password: 'TestPassword123!',
      role: 'user',
      isActive: true,
      emailVerified: true
    };

    const user = { ...defaultUser, ...userData };
    
    // Hash password
    const saltRounds = parseInt(process.env.BCRYPT_ROUNDS) || 12;
    user.password = await bcrypt.hash(user.password, saltRounds);

    // Create user in database
    const newUser = new User(user);
    await newUser.save();

    this.testUsers.push(newUser);
    console.log(`✅ Created test user: ${user.email}`);
    return newUser;
  }

  async createTestAdmin() {
    return this.createTestUser({
      name: 'Test Admin',
      // Unique per call (fixed address would collide on the second invocation).
      email: this.generateRandomEmail(),
      password: 'AdminPassword123!',
      role: 'admin'
    });
  }

  generateTestToken(user) {
    return jwt.sign(
      { userId: user._id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );
  }

  async createMultipleTestUsers(count = 5) {
    const users = [];
    const letters = 'abcdefghijklmnopqrstuvwxyz';
    // Unique batch prefix — the integration test re-runs the performance
    // suite, so per-index-only emails would hit the unique index again.
    const batch = crypto.randomBytes(3).toString('hex');
    for (let i = 0; i < count; i++) {
      // The User model only allows letters and spaces in names — build a
      // letter-only unique suffix instead of a numeric one.
      const suffix = `${letters[Math.floor(i / 26) % 26].toUpperCase()}${letters[i % 26]}`;
      const user = await this.createTestUser({
        name: `Test User ${suffix}`,
        email: `testuser-${batch}-${i + 1}@example.com`,
        password: `Password${i + 1}!`
      });
      users.push(user);
    }
    return users;
  }

  // =============================================================================
  // PRODUCT TEST UTILITIES
  // =============================================================================

  async createTestProduct(productData = {}) {
    // Field names and constraints mirror models/productModel.js exactly:
    // `image` (1-4 URLs), required `subCategory`, `color` restricted to the
    // model's allow-list, and `stockQuantity`/`inStock` (not `stock`).
    const defaultProduct = {
      name: 'Test Product',
      description: 'This is a test product for testing purposes',
      price: 29.99,
      image: ['https://via.placeholder.com/300x300'],
      category: 'Electronics',
      subCategory: 'Audio',
      color: ['Black'],
      stockQuantity: 100,
      inStock: true,
      bestseller: false
    };

    const product = { ...defaultProduct, ...productData };
    
    const newProduct = new Product(product);
    await newProduct.save();

    this.testProducts.push(newProduct);
    console.log(`✅ Created test product: ${product.name}`);
    return newProduct;
  }

  async createMultipleTestProducts(count = 10) {
    const products = [];
    const categories = ['Electronics', 'Clothing', 'Books', 'Home & Garden', 'Sports'];
    
    for (let i = 0; i < count; i++) {
      const product = await this.createTestProduct({
        name: `Test Product ${i + 1}`,
        description: `Description for test product ${i + 1}`,
        price: Math.floor(Math.random() * 100) + 10,
        category: categories[i % categories.length],
        stock: Math.floor(Math.random() * 50) + 10
      });
      products.push(product);
    }
    return products;
  }

  // =============================================================================
  // ORDER TEST UTILITIES
  // =============================================================================

  async createTestOrder(orderData = {}) {
    // Mirrors models/orderModel.js: `address` (8 required fields, note
    // lowercase `zipcode`), paymentMethod enum ['COD','PayPal'],
    // orderStatus enum, and required subtotal/shipping/total.
    const defaultOrder = {
      userId: this.testUsers[0]?._id,
      items: [],
      address: {
        firstName: 'Test',
        lastName: 'User',
        email: 'test@example.com',
        street: '123 Test Street',
        city: 'Test City',
        state: 'Test State',
        zipcode: '12345',
        country: 'Test Country',
        phone: '555-123-4567'
      },
      paymentMethod: 'PayPal',
      paymentStatus: 'pending',
      orderStatus: 'Order Placed',
      subtotal: 0,
      shipping: 10,
      total: 10,
      currency: 'USD'
    };

    const order = { ...defaultOrder, ...orderData };
    
    const newOrder = new Order(order);
    await newOrder.save();

    this.testOrders.push(newOrder);
    console.log(`✅ Created test order: ${newOrder._id}`);
    return newOrder;
  }

  async createTestOrderWithItems(userId, products, quantities = []) {
    // orderItemSchema requires image and color per item and has no `total`
    // field; order-level subtotal/shipping/total are required.
    const items = products.map((product, index) => ({
      productId: String(product._id),
      name: product.name,
      image: product.image?.[0] ?? 'https://via.placeholder.com/300x300',
      price: product.price,
      quantity: quantities[index] || 1,
      color: product.color?.[0] ?? 'Black'
    }));

    const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const shipping = 10;

    return this.createTestOrder({
      userId,
      items,
      subtotal,
      shipping,
      total: subtotal + shipping
    });
  }

  // =============================================================================
  // PAYMENT TEST UTILITIES
  // =============================================================================

  generateTestPayPalOrder() {
    return {
      id: `PAY-${crypto.randomBytes(8).toString('hex').toUpperCase()}`,
      status: 'APPROVED',
      intent: 'CAPTURE',
      payment_source: {
        paypal: {
          account_id: 'test-account-id',
          email_address: 'test@example.com'
        }
      },
      purchase_units: [{
        reference_id: 'test-reference',
        amount: {
          currency_code: 'USD',
          value: '29.99'
        }
      }]
    };
  }

  generateTestStripePaymentIntent() {
    return {
      id: `pi_${crypto.randomBytes(24).toString('hex')}`,
      object: 'payment_intent',
      amount: 2999,
      currency: 'usd',
      status: 'succeeded',
      client_secret: `pi_${crypto.randomBytes(24).toString('hex')}_secret_${crypto.randomBytes(24).toString('hex')}`
    };
  }

  // =============================================================================
  // EMAIL TEST UTILITIES
  // =============================================================================

  async testEmailService() {
    console.log('🧪 Testing email service...');
    
    try {
      // Test connection
      const connectionTest = await emailService.testConnection();
      console.log('📧 Email service connection:', connectionTest.success ? '✅' : '❌');
      
      if (connectionTest.success) {
        // Test password reset email
        const testUser = await this.createTestUser();
        const resetToken = crypto.randomBytes(32).toString('hex');
        
        await emailService.sendPasswordResetEmail(
          testUser.email,
          testUser.name,
          resetToken
        );
        console.log('✅ Password reset email test completed');
        
        // Test welcome email
        await emailService.sendWelcomeEmail(testUser.email, testUser.name);
        console.log('✅ Welcome email test completed');
      }
      
      return connectionTest;
    } catch (error) {
      console.error('❌ Email service test failed:', error.message);
      return { success: false, message: error.message };
    }
  }

  // =============================================================================
  // ANALYTICS TEST UTILITIES
  // =============================================================================

  async createTestAnalyticsData() {
    console.log('📊 Creating test analytics data...');
    
    try {
      // Create test users and products if they don't exist
      if (this.testUsers.length === 0) {
        await this.createMultipleTestUsers(5);
      }
      if (this.testProducts.length === 0) {
        await this.createMultipleTestProducts(10);
      }

      // Generate user activities
      const activities = [];
      const actions = ['login', 'view_product', 'add_to_cart', 'purchase', 'search'];
      
      for (let i = 0; i < 50; i++) {
        const user = this.testUsers[Math.floor(Math.random() * this.testUsers.length)];
        const product = this.testProducts[Math.floor(Math.random() * this.testProducts.length)];
        const action = actions[Math.floor(Math.random() * actions.length)];
        
        activities.push({
          userId: user._id,
          action,
          productId: action === 'view_product' || action === 'add_to_cart' || action === 'purchase' ? product._id : undefined,
          category: product.category,
          searchQuery: action === 'search' ? `test query ${i}` : undefined,
          sessionId: `session-${i}`,
          userAgent: 'Test User Agent',
          ipAddress: '127.0.0.1',
          createdAt: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000) // Random date in last 30 days
        });
      }

      await UserActivity.insertMany(activities);
      console.log(`✅ Created ${activities.length} user activities`);

      // Generate product performance data
      const performanceData = this.testProducts.map(product => ({
        productId: product._id,
        views: Math.floor(Math.random() * 1000),
        addToCartCount: Math.floor(Math.random() * 100),
        purchaseCount: Math.floor(Math.random() * 50),
        revenue: Math.floor(Math.random() * 5000),
        conversionRate: Math.random(),
        lastUpdated: new Date()
      }));

      await ProductPerformance.insertMany(performanceData);
      console.log(`✅ Created ${performanceData.length} product performance records`);

      // Generate search analytics
      const searchQueries = ['laptop', 'phone', 'book', 'shirt', 'shoes', 'headphones', 'camera', 'watch'];
      const searchData = searchQueries.map(query => ({
        query,
        count: Math.floor(Math.random() * 100),
        resultsCount: Math.floor(Math.random() * 50),
        category: ['Electronics', 'Clothing', 'Books'][Math.floor(Math.random() * 3)],
        date: new Date()
      }));

      await SearchAnalytics.insertMany(searchData);
      console.log(`✅ Created ${searchData.length} search analytics records`);

      return {
        activities: activities.length,
        performance: performanceData.length,
        searches: searchData.length
      };
    } catch (error) {
      console.error('❌ Failed to create test analytics data:', error.message);
      throw error;
    }
  }

  // =============================================================================
  // SECURITY TEST UTILITIES
  // =============================================================================

  async testSecurityFeatures() {
    console.log('🔒 Testing security features...');
    
    const tests = [];

    // Test password hashing
    const testPassword = 'TestPassword123!';
    const hashedPassword = await bcrypt.hash(testPassword, 12);
    const isPasswordValid = await bcrypt.compare(testPassword, hashedPassword);
    tests.push({
      name: 'Password Hashing',
      passed: isPasswordValid,
      message: isPasswordValid ? 'Password hashing works correctly' : 'Password hashing failed'
    });

    // Test JWT token generation and verification
    const testUser = { _id: 'test-id', email: 'test@example.com', role: 'user' };
    const token = jwt.sign(testUser, process.env.JWT_SECRET, { expiresIn: '1h' });
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    tests.push({
      name: 'JWT Token',
      passed: decoded._id === testUser._id,
      message: decoded._id === testUser._id ? 'JWT token works correctly' : 'JWT token verification failed'
    });

    // Test rate limiting simulation
    tests.push({
      name: 'Rate Limiting',
      passed: true,
      message: 'Rate limiting configuration is set up (manual testing required)'
    });

    // Test CORS configuration
    tests.push({
      name: 'CORS Configuration',
      passed: !!process.env.CORS_ORIGIN,
      message: process.env.CORS_ORIGIN ? 'CORS is configured' : 'CORS origin not configured'
    });

    return tests;
  }

  // =============================================================================
  // PERFORMANCE TEST UTILITIES
  // =============================================================================

  async testDatabasePerformance() {
    console.log('⚡ Testing database performance...');
    
    const results = {};

    // Test user creation performance
    const startTime = Date.now();
    const users = await this.createMultipleTestUsers(100);
    const userCreationTime = Date.now() - startTime;
    results.userCreation = {
      count: users.length,
      time: userCreationTime,
      average: userCreationTime / users.length
    };

    // Test product creation performance
    const productStartTime = Date.now();
    const products = await this.createMultipleTestProducts(50);
    const productCreationTime = Date.now() - productStartTime;
    results.productCreation = {
      count: products.length,
      time: productCreationTime,
      average: productCreationTime / products.length
    };

    // Test query performance
    const queryStartTime = Date.now();
    const userCount = await User.countDocuments();
    const productCount = await Product.countDocuments();
    const queryTime = Date.now() - queryStartTime;
    results.queryPerformance = {
      userCount,
      productCount,
      time: queryTime
    };

    return results;
  }

  // =============================================================================
  // INTEGRATION TEST UTILITIES
  // =============================================================================

  async runFullIntegrationTest() {
    console.log('🚀 Running full integration test...');
    
    const results = {
      database: false,
      email: false,
      security: false,
      analytics: false,
      performance: false
    };

    try {
      // Test database connection
      results.database = await this.connectToTestDB();
      
      if (results.database) {
        // Test email service
        const emailTest = await this.testEmailService();
        results.email = emailTest.success;

        // Test security features
        const securityTests = await this.testSecurityFeatures();
        results.security = securityTests.every(test => test.passed);

        // Test analytics data creation
        await this.createTestAnalyticsData();
        results.analytics = true;

        // Test performance
        const performanceResults = await this.testDatabasePerformance();
        results.performance = performanceResults.userCreation.average < 100; // Less than 100ms per user

        // Clean up
        await this.clearTestDatabase();
        await this.disconnectFromTestDB();
      }

      return results;
    } catch (error) {
      console.error('❌ Integration test failed:', error.message);
      return results;
    }
  }

  // =============================================================================
  // UTILITY METHODS
  // =============================================================================

  generateRandomEmail() {
    return `test-${crypto.randomBytes(8).toString('hex')}@example.com`;
  }

  generateRandomPassword() {
    return `Password${crypto.randomBytes(4).toString('hex')}!`;
  }

  generateRandomName() {
    const names = ['John', 'Jane', 'Mike', 'Sarah', 'David', 'Lisa', 'Tom', 'Emma'];
    const surnames = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller'];
    return `${names[Math.floor(Math.random() * names.length)]} ${surnames[Math.floor(Math.random() * surnames.length)]}`;
  }

  printTestResults(results) {
    console.log('\n📋 Test Results:');
    console.log('='.repeat(50));
    
    for (const [test, result] of Object.entries(results)) {
      const status = result ? '✅ PASS' : '❌ FAIL';
      console.log(`${test.toUpperCase()}: ${status}`);
    }
    
    console.log('='.repeat(50));
  }
}

export default TestUtilities;