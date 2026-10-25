#!/usr/bin/env node

/**
 * Admin Authentication Debug Script
 * 
 * This script helps debug the PayPal analytics authentication issue
 * Run with: node debug-admin-auth.js
 */

// Configuration
const BACKEND_URL = 'http://localhost:3001';
const ADMIN_URL = 'http://localhost:5174';

async function debugAdminAuth() {
  console.log('🔍 Debugging Admin Authentication & PayPal Analytics...\n');

  try {
    // Step 1: Check if servers are running
    console.log('1️⃣ Checking server status...');
    
    const backendCheck = await fetch(`${BACKEND_URL}/`);
    if (backendCheck.ok) {
      console.log('✅ Backend is running on port 3001');
    } else {
      console.log('❌ Backend is not responding');
      return;
    }

    const adminCheck = await fetch(`${ADMIN_URL}`);
    if (adminCheck.ok) {
      console.log('✅ Admin panel is running on port 5174');
    } else {
      console.log('❌ Admin panel is not responding');
      return;
    }

    // Step 2: Test PayPal analytics endpoint without auth
    console.log('\n2️⃣ Testing PayPal analytics endpoint...');
    const analyticsResponse = await fetch(`${BACKEND_URL}/api/analytics/paypal`, {
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

    // Step 3: Manual debugging steps
    console.log('\n3️⃣ Manual Debugging Steps:');
    console.log('');
    console.log('   🔐 **Authentication Check**:');
    console.log('   1. Open browser and go to: http://localhost:5174');
    console.log('   2. Login to admin panel with your credentials');
    console.log('   3. Open DevTools (F12) > Application > Local Storage');
    console.log('   4. Look for "token" key - it should exist and not be empty');
    console.log('');
    console.log('   🌐 **Network Check**:');
    console.log('   1. In DevTools, go to Network tab');
    console.log('   2. Navigate to Analytics > PayPal Analytics');
    console.log('   3. Look for request to: /api/analytics/paypal');
    console.log('   4. Check if request includes Authorization header');
    console.log('   5. Check response status (should be 200, not 401)');
    console.log('');
    console.log('   📊 **Data Check**:');
    console.log('   1. Go to Orders page in admin panel');
    console.log('   2. Look for orders with payment method "PayPal"');
    console.log('   3. Check if any have payment status "completed"');
    console.log('   4. If no PayPal orders exist, analytics will show "No data"');

    // Step 4: Common solutions
    console.log('\n4️⃣ Common Solutions:');
    console.log('');
    console.log('   **If token is missing or expired**:');
    console.log('   - Logout and login again to admin panel');
    console.log('   - Clear browser cache and cookies');
    console.log('   - Try incognito/private browsing mode');
    console.log('');
    console.log('   **If no PayPal data exists**:');
    console.log('   - Make a test PayPal payment first');
    console.log('   - Use personal account: sb-43padr43394022@personal.example.com');
    console.log('   - Password: <redacted — see your PayPal sandbox account settings>');
    console.log('');
    console.log('   **If network request fails**:');
    console.log('   - Check if backend is running on port 3001');
    console.log('   - Verify CORS settings');
    console.log('   - Check browser console for errors');

    // Step 5: Test with sample token (if you have one)
    console.log('\n5️⃣ Quick Test with Token:');
    console.log('   If you have a valid token, you can test with:');
    console.log('   curl -X GET "http://localhost:3001/api/analytics/paypal" \\');
    console.log('     -H "Authorization: Bearer YOUR_TOKEN_HERE" \\');
    console.log('     -H "Content-Type: application/json"');

    console.log('\n🎯 **Next Steps**:');
    console.log('   1. Follow the manual debugging steps above');
    console.log('   2. Check browser console for specific error messages');
    console.log('   3. Verify admin authentication is working');
    console.log('   4. Make a test PayPal payment if no data exists');

  } catch (error) {
    console.error('❌ Debug failed:', error);
  }
}

// Run the debug
debugAdminAuth(); 