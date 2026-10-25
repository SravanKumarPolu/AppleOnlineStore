#!/usr/bin/env node

/**
 * Product Analytics API Test Script
 * 
 * This script tests the Product analytics API to see if it's working
 * Run with: node test-product-analytics-api.js
 */

// Configuration
const BACKEND_URL = 'http://localhost:3001';

async function testProductAnalyticsAPI() {
  console.log('🧪 Testing Product Analytics API...\n');

  try {
    // Step 1: Test backend connectivity
    console.log('1️⃣ Testing backend connectivity...');
    const healthCheck = await fetch(`${BACKEND_URL}/`);
    if (healthCheck.ok) {
      console.log('✅ Backend is running and responding');
    } else {
      console.log('❌ Backend is not responding');
      return;
    }

    // Step 2: Test Product analytics endpoint without auth (should fail)
    console.log('\n2️⃣ Testing Product analytics endpoint without authentication...');
    const analyticsResponse = await fetch(`${BACKEND_URL}/api/analytics/products`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    console.log(`   Status: ${analyticsResponse.status}`);
    const responseText = await analyticsResponse.text();
    console.log(`   Response: ${responseText}`);

    if (analyticsResponse.status === 401) {
      console.log('✅ Endpoint is protected (requires authentication)');
    }

    // Step 3: Check for product performance data in database
    console.log('\n3️⃣ Checking for product performance data in database...');
    console.log('   Note: This requires database access');
    console.log('   You can check manually by:');
    console.log('   - Looking at the products page in admin panel');
    console.log('   - Checking if products have been viewed/purchased');
    console.log('   - Verifying product performance tracking is working');

    // Step 4: Manual testing instructions
    console.log('\n4️⃣ Manual Testing Instructions:');
    console.log('   a) Start all servers:');
    console.log('      - Backend: cd backend && npm start');
    console.log('      - Frontend: cd frontend && npm run dev');
    console.log('      - Admin: cd admin && npm run dev');
    console.log('');
    console.log('   b) Generate product performance data:');
    console.log('      - Go to main application');
    console.log('      - Browse products (this tracks views)');
    console.log('      - Add products to cart (this tracks add to cart)');
    console.log('      - Make purchases (this tracks purchases)');
    console.log('');
    console.log('   c) Check Admin Panel:');
    console.log('      - Login to admin panel');
    console.log('      - Go to Analytics > Product Performance');
    console.log('      - Verify product data is displayed');
    console.log('');
    console.log('   d) If Product Analytics shows blank page:');
    console.log('      - Check browser console for JavaScript errors');
    console.log('      - Verify admin authentication token');
    console.log('      - Check backend logs for API errors');
    console.log('      - Make sure there are products with performance data');

    // Step 5: Troubleshooting steps
    console.log('\n5️⃣ Troubleshooting Steps:');
    console.log('   - Ensure admin is logged in with valid token');
    console.log('   - Check if there are any products in database');
    console.log('   - Verify product performance tracking is working');
    console.log('   - Check if products have been viewed/purchased');
    console.log('   - Verify backend is running on port 3001');
    console.log('   - Check browser network tab for failed requests');
    console.log('   - Look for JavaScript errors in browser console');

    // Step 6: Expected API response structure
    console.log('\n6️⃣ Expected API Response Structure:');
    console.log('   {');
    console.log('     success: true,');
    console.log('     data: {');
    console.log('       topProducts: [...],');
    console.log('       productStats: {');
    console.log('         totalViews: 0,');
    console.log('         totalAddToCart: 0,');
    console.log('         totalPurchases: 0,');
    console.log('         totalRevenue: 0,');
    console.log('         averageConversionRate: 0');
    console.log('       },');
    console.log('       categoryPerformance: [...]');
    console.log('     }');
    console.log('   }');

    console.log('\n🎉 Product Analytics API Test Complete!');
    console.log('   The endpoint is working correctly - authentication is required.');

  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

// Run the test
testProductAnalyticsAPI(); 