import mongoose from 'mongoose';
import categoryModel from '../models/categoryModel.js';
import 'dotenv/config';
import { resolveMongoConnectionUri } from '../config/mongodb.js';
import { summarizeMongoUri } from '../utils/redact.js';

const testCategories = async () => {
  try {
    // Connect to MongoDB using the shared resolver — never log the raw URI.
    const { uri } = resolveMongoConnectionUri(process.env);
    console.log('🔌 Connecting to MongoDB:', summarizeMongoUri(uri));
    
    await mongoose.connect(uri);
    console.log('✅ Connected to MongoDB');
    console.log('📊 Database name:', mongoose.connection.name);
    console.log('📍 Host:', mongoose.connection.host);
    console.log('🔢 Port:', mongoose.connection.port);

    // Test direct query
    console.log('\n🔍 Testing direct query...');
    const allCategories = await categoryModel.find({});
    console.log('📂 All categories found:', allCategories.length);
    
    if (allCategories.length > 0) {
      console.log('📂 Category names:', allCategories.map(c => c.name));
      console.log('📂 First category details:', JSON.stringify(allCategories[0], null, 2));
    }

    // Test active categories query
    console.log('\n🔍 Testing active categories query...');
    const activeCategories = await categoryModel.find({ isActive: true });
    console.log('📂 Active categories found:', activeCategories.length);

    // Test the static method
    console.log('\n🔍 Testing getActiveCategories static method...');
    const staticCategories = await categoryModel.getActiveCategories();
    console.log('📂 Static method categories found:', staticCategories.length);

    // List all collections
    console.log('\n📚 All collections in database:');
    const collections = await mongoose.connection.db.listCollections().toArray();
    collections.forEach(collection => {
      console.log(`- ${collection.name}`);
    });

    process.exit(0);

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
};

// Run the test
testCategories(); 