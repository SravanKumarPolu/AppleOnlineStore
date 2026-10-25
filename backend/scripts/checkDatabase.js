import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { resolveMongoConnectionUri } from '../config/mongodb.js';
import { summarizeMongoUri } from '../utils/redact.js';

dotenv.config();

const checkDatabase = async () => {
  try {
    // Shared resolver (config/mongodb.js) — supports complete URIs and the
    // explicit default database. The raw URI is NEVER logged (credentials).
    const { uri } = resolveMongoConnectionUri(process.env);
    console.log('🔌 Connecting to MongoDB:', summarizeMongoUri(uri));
    
    await mongoose.connect(uri);
    console.log('✅ Connected to database:', mongoose.connection.db.databaseName);
    console.log('📍 Host:', mongoose.connection.host);
    console.log('🔢 Port:', mongoose.connection.port);
    
    // List all collections
    const collections = await mongoose.connection.db.listCollections().toArray();
    console.log('\n📚 Collections in database:');
    collections.forEach(collection => {
      console.log(`  - ${collection.name}`);
    });
    
    // Check orders collection specifically
    const ordersCollection = mongoose.connection.db.collection('orders');
    const orderCount = await ordersCollection.countDocuments();
    console.log(`\n📦 Orders collection count: ${orderCount}`);
    
    if (orderCount > 0) {
      const sampleOrder = await ordersCollection.findOne();
      console.log('\n📄 Sample order:');
      console.log(JSON.stringify(sampleOrder, null, 2));
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\n🔌 Disconnected from MongoDB');
  }
};

checkDatabase(); 