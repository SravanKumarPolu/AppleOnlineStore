import mongoose from 'mongoose';
import orderModel from '../models/orderModel.js';
import userModel from '../models/userModel.js';
import dotenv from 'dotenv';
import { resolveMongoConnectionUri } from '../config/mongodb.js';

dotenv.config();

const migrateOrders = async () => {
  try {
    // Connect to MongoDB via the shared resolver (supports complete URIs
    // and the explicit default database; see config/mongodb.js).
    const { uri } = resolveMongoConnectionUri(process.env);
    await mongoose.connect(uri);
    console.log('✅ Connected to MongoDB');

    // Get all orders
    const orders = await orderModel.find({});
    console.log(`📦 Found ${orders.length} orders to migrate`);

    // Group orders by user
    const ordersByUser = {};
    orders.forEach(order => {
      const userId = order.userId.toString();
      if (!ordersByUser[userId]) {
        ordersByUser[userId] = [];
      }
      ordersByUser[userId].push(order._id);
    });

    console.log(`👥 Found ${Object.keys(ordersByUser).length} users with orders`);

    // Update each user with their orders
    for (const [userId, orderIds] of Object.entries(ordersByUser)) {
      try {
        await userModel.findByIdAndUpdate(
          userId,
          { $addToSet: { orders: { $each: orderIds } } }
        );
        console.log(`✅ Updated user ${userId} with ${orderIds.length} orders`);
      } catch (error) {
        console.error(`❌ Error updating user ${userId}:`, error.message);
      }
    }

    // Verify migration
    const usersWithOrders = await userModel.find({ 
      orders: { $exists: true, $ne: [] } 
    }).select('name email orders');
    
    console.log(`\n🎉 Migration complete!`);
    console.log(`📊 Users with orders: ${usersWithOrders.length}`);
    
    usersWithOrders.forEach(user => {
      console.log(`  - ${user.name} (${user.email}): ${user.orders.length} orders`);
    });

  } catch (error) {
    console.error('❌ Migration failed:', error);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB');
  }
};

// Run migration if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  migrateOrders();
}

export default migrateOrders; 