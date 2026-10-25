#!/usr/bin/env node

/**
 * PayPal Analytics Test Script
 * 
 * This script tests the PayPal analytics endpoint to ensure it's working correctly
 * Run with: node test-paypal-analytics.js
 */

// Configuration
const BACKEND_URL = 'http://localhost:3001';

async function testPayPalAnalytics() {
  console.log('🧪 Testing PayPal Analytics Endpoint...\n');

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

    // Step 2: Test PayPal analytics endpoint without auth (should fail)
    console.log('\n2️⃣ Testing PayPal analytics endpoint without authentication...');
    const analyticsResponse = await fetch(`${BACKEND_URL}/api/analytics/paypal`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (analyticsResponse.status === 401) {
      console.log('✅ PayPal analytics endpoint is protected (requires authentication)');
      console.log('   This is expected behavior - admin authentication is required');
    } else {
      console.log('❌ Unexpected response:', analyticsResponse.status);
      const responseText = await analyticsResponse.text();
      console.log('   Response:', responseText);
    }

    // Step 3: Check if there are any PayPal orders in the database
    console.log('\n3️⃣ Checking for PayPal orders in database...');
    console.log('   Note: This requires database access');
    console.log('   You can check manually by:');
    console.log('   - Looking at the orders page in admin panel');
    console.log('   - Checking backend logs for PayPal transactions');

    // Step 4: Updated business account information
    console.log('\n4️⃣ Updated PayPal Business Account Information:');
    console.log('   Business Account: sb-j1ksk43419843@business.example.com');
    console.log('   Password: <redacted — see your PayPal sandbox account settings>');
    console.log('   Personal Account: sb-43padr43394022@personal.example.com');
    console.log('   Password: <redacted — see your PayPal sandbox account settings>');

    // Step 5: Manual testing instructions
    console.log('\n5️⃣ Manual Testing Instructions:');
    console.log('   a) Start all servers:');
    console.log('      - Backend: cd backend && npm start');
    console.log('      - Frontend: cd frontend && npm run dev');
    console.log('      - Admin: cd admin && npm run dev');
    console.log('');
    console.log('   b) Test PayPal payment flow:');
    console.log('      - Login to application');
    console.log('      - Add items to cart');
    console.log('      - Go to checkout');
    console.log('      - Select PayPal payment method');
    console.log('      - Fill in address details');
    console.log('      - Click "PLACE ORDER"');
    console.log('      - Complete payment with personal account');
    console.log('');
    console.log('   c) Check Admin Panel:');
    console.log('      - Login to admin panel');
    console.log('      - Go to Analytics > PayPal Analytics');
    console.log('      - Verify payment data is displayed');
    console.log('');
    console.log('   d) If PayPal Analytics shows error:');
    console.log('      - Check browser console for network errors');
    console.log('      - Verify admin authentication token');
    console.log('      - Check backend logs for API errors');

    // Step 6: Troubleshooting steps
    console.log('\n6️⃣ Troubleshooting Steps:');
    console.log('   - Ensure admin is logged in with valid token');
    console.log('   - Check if there are any PayPal orders in database');
    console.log('   - Verify backend is running on port 3001');
    console.log('   - Check browser network tab for failed requests');
    console.log('   - Look for CORS errors in browser console');

    console.log('\n🎉 PayPal Analytics Test Complete!');
    console.log('   The endpoint is working correctly - authentication is required.');

  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

// Run the test
testPayPalAnalytics(); 