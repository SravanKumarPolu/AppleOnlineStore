import mongoose from 'mongoose';
import { UserActivity, ProductPerformance, SearchAnalytics } from '../models/analyticsModel.js';
import productModel from '../models/productModel.js';
import userModel from '../models/userModel.js';
import orderModel from '../models/orderModel.js';
import dotenv from 'dotenv';

dotenv.config();

const populateAnalytics = async () => {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    // Get some sample data
    const products = await productModel.find().limit(10);
    const users = await userModel.find().limit(5);
    const orders = await orderModel.find().limit(20);

    if (products.length === 0 || users.length === 0) {
      console.log('No products or users found. Please add some data first.');
      return;
    }

    console.log(`Found ${products.length} products, ${users.length} users, ${orders.length} orders`);

    // Clear existing analytics data
    await UserActivity.deleteMany({});
    await ProductPerformance.deleteMany({});
    await SearchAnalytics.deleteMany({});

    console.log('Cleared existing analytics data');

    // Populate user activities
    const activities = [];
    const actions = ['login', 'logout', 'view_product', 'add_to_cart', 'remove_from_cart', 'purchase', 'search', 'filter'];
    
    for (let i = 0; i < 100; i++) {
      const user = users[Math.floor(Math.random() * users.length)];
      const product = products[Math.floor(Math.random() * products.length)];
      const action = actions[Math.floor(Math.random() * actions.length)];
      
      const activity = {
        userId: user._id,
        action,
        productId: action.includes('product') || action.includes('cart') || action.includes('purchase') ? product._id : undefined,
        category: action.includes('product') || action.includes('cart') || action.includes('purchase') ? product.category : undefined,
        searchQuery: action === 'search' ? ['iphone', 'macbook', 'airpods', 'watch', 'ipad'][Math.floor(Math.random() * 5)] : undefined,
        sessionId: `session_${Math.floor(Math.random() * 1000)}`,
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        ipAddress: `192.168.1.${Math.floor(Math.random() * 255)}`,
        createdAt: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000) // Random date in last 30 days
      };
      
      activities.push(activity);
    }

    await UserActivity.insertMany(activities);
    console.log(`Created ${activities.length} user activities`);

    // Populate product performance
    const productMetrics = [];
    for (const product of products) {
      const views = Math.floor(Math.random() * 1000) + 100;
      const addToCartCount = Math.floor(Math.random() * 100) + 10;
      const purchaseCount = Math.floor(Math.random() * 50) + 5;
      const revenue = purchaseCount * product.price;
      const conversionRate = views > 0 ? purchaseCount / views : 0;

      productMetrics.push({
        productId: product._id,
        views,
        addToCartCount,
        purchaseCount,
        revenue,
        conversionRate,
        lastUpdated: new Date()
      });
    }

    await ProductPerformance.insertMany(productMetrics);
    console.log(`Created ${productMetrics.length} product performance records`);

    // Populate search analytics
    const searchQueries = [
      { query: 'iphone', category: 'iPhone' },
      { query: 'macbook', category: 'Mac' },
      { query: 'airpods', category: 'AirPods' },
      { query: 'watch', category: 'Watch' },
      { query: 'ipad', category: 'iPad' },
      { query: 'accessories', category: 'Accessories' },
      { query: 'pro', category: null },
      { query: 'air', category: null },
      { query: 'mini', category: null },
      { query: 'ultra', category: null }
    ];

    const searchAnalytics = [];
    for (const searchQuery of searchQueries) {
      const count = Math.floor(Math.random() * 50) + 5;
      const resultsCount = Math.floor(Math.random() * 20) + 1;
      
      searchAnalytics.push({
        query: searchQuery.query,
        count,
        resultsCount,
        category: searchQuery.category,
        date: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000)
      });
    }

    await SearchAnalytics.insertMany(searchAnalytics);
    console.log(`Created ${searchAnalytics.length} search analytics records`);

    console.log('Analytics data populated successfully!');
    
    // Print some summary statistics
    const totalActivities = await UserActivity.countDocuments();
    const totalProductMetrics = await ProductPerformance.countDocuments();
    const totalSearches = await SearchAnalytics.countDocuments();
    
    console.log('\nSummary:');
    console.log(`- Total user activities: ${totalActivities}`);
    console.log(`- Total product performance records: ${totalProductMetrics}`);
    console.log(`- Total search analytics records: ${totalSearches}`);

  } catch (error) {
    console.error('Error populating analytics data:', error);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  }
};

// Run the script
populateAnalytics(); 