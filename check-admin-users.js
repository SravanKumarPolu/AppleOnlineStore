#!/usr/bin/env node

/**
 * Admin User Check Script
 * 
 * This script checks for admin users and helps create one if needed
 * Run with: node check-admin-users.js
 */

import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';

dotenv.config();

// Connect to MongoDB
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');
  } catch (error) {
    console.error('❌ MongoDB connection failed:', error);
    process.exit(1);
  }
};

// User Schema (simplified for this script)
const userSchema = new mongoose.Schema({
  name: String,
  email: String,
  password: String,
  isAdmin: { type: Boolean, default: false }
});

const User = mongoose.models.User || mongoose.model('User', userSchema);

async function checkAdminUsers() {
  console.log('🔍 Checking Admin Users...\n');

  try {
    await connectDB();

    // Check for existing admin users
    const adminUsers = await User.find({ isAdmin: true });
    
    console.log(`📊 Found ${adminUsers.length} admin user(s):`);
    
    if (adminUsers.length > 0) {
      adminUsers.forEach((user, index) => {
        console.log(`   ${index + 1}. ${user.name} (${user.email})`);
      });
      
      console.log('\n✅ Admin users exist. You can login with any of these accounts.');
      console.log('\n🔐 **Login Instructions**:');
      console.log('   1. Go to: http://localhost:5174');
      console.log('   2. Use one of the admin accounts above');
      console.log('   3. If you don\'t know the password, create a new admin account');
      
    } else {
      console.log('❌ No admin users found!');
      console.log('\n🔧 **Creating Admin User**:');
      
      // Create a default admin user
      // Phase 4 redaction: the seed password is generated randomly per run
      // (previously a hardcoded weak default committed to the repository).
      const seedPassword = require('crypto').randomBytes(12).toString('hex');
      const hashedPassword = await bcrypt.hash(seedPassword, 10);
      
      const adminUser = new User({
        name: 'Admin User',
        email: 'admin@example.com',
        password: hashedPassword,
        isAdmin: true
      });
      
      await adminUser.save();
      
      console.log('✅ Created default admin user:');
      console.log('   Email: admin@example.com');
      console.log('   Password: <generated per run — see above>');
      console.log('   Name: Admin User');
      
      console.log('\n🔐 **Login Instructions**:');
      console.log('   1. Go to: http://localhost:5174');
      console.log('   2. Login with: admin@example.com / <generated per run>');
      console.log('   3. Then try PayPal Analytics again');
    }

    // Check for any users (admin or not)
    const allUsers = await User.find();
    console.log(`\n📈 Total users in database: ${allUsers.length}`);
    
    if (allUsers.length > 0) {
      console.log('\n👥 All users:');
      allUsers.forEach((user, index) => {
        console.log(`   ${index + 1}. ${user.name} (${user.email}) - Admin: ${user.isAdmin ? 'Yes' : 'No'}`);
      });
    }

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\n🔌 Disconnected from MongoDB');
  }
}

// Run the check
checkAdminUsers(); 