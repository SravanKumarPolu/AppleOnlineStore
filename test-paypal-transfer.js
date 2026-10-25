#!/usr/bin/env node

/**
 * PayPal Transfer API Test Script
 * Tests the PayPal transfer functionality endpoints
 */

const BASE_URL = 'http://localhost:3001';
// Phase 4 redaction: credentials come from the environment — never committed.
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'you@example.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '<set ADMIN_PASSWORD>';
if (!process.env.ADMIN_PASSWORD) { console.error('Set ADMIN_EMAIL / ADMIN_PASSWORD before running.'); process.exit(1); }

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSuccess(message) {
  log(`✅ ${message}`, 'green');
}

function logError(message) {
  log(`❌ ${message}`, 'red');
}

function logInfo(message) {
  log(`ℹ️  ${message}`, 'blue');
}

function logWarning(message) {
  log(`⚠️  ${message}`, 'yellow');
}

async function testAdminLogin() {
  logInfo('Testing admin login...');
  
  try {
    const response = await fetch(`${BASE_URL}/api/user/admin`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: ADMIN_EMAIL,
        password: ADMIN_PASSWORD
      })
    });

    const data = await response.json();
    
    if (data.success && data.token) {
      logSuccess('Admin login successful');
      return data.token;
    } else {
      logError(`Admin login failed: ${data.message}`);
      return null;
    }
  } catch (error) {
    logError(`Admin login error: ${error.message}`);
    return null;
  }
}

async function testCreateTransfer(token, amount = 25.00, note = 'Test transfer from script') {
  logInfo(`Testing PayPal transfer creation ($${amount})...`);
  
  try {
    const response = await fetch(`${BASE_URL}/api/paypal-transfer/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        amount: amount,
        note: note
      })
    });

    const data = await response.json();
    
    if (data.success) {
      logSuccess(`Transfer created successfully! Batch ID: ${data.transfer.batchId}`);
      return data.transfer;
    } else {
      logError(`Transfer creation failed: ${data.message}`);
      return null;
    }
  } catch (error) {
    logError(`Transfer creation error: ${error.message}`);
    return null;
  }
}

async function testGetTransferHistory(token) {
  logInfo('Testing transfer history retrieval...');
  
  try {
    const response = await fetch(`${BASE_URL}/api/paypal-transfer/history`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    const data = await response.json();
    
    if (data.success) {
      logSuccess(`Transfer history retrieved successfully! Found ${data.data.transfers.length} transfers`);
      logInfo(`Total amount: $${data.data.summary.totalAmount}`);
      logInfo(`Average amount: $${data.data.summary.averageAmount}`);
      return data.data;
    } else {
      logError(`Transfer history failed: ${data.message}`);
      return null;
    }
  } catch (error) {
    logError(`Transfer history error: ${error.message}`);
    return null;
  }
}

async function testInvalidAmount(token) {
  logInfo('Testing invalid amount validation...');
  
  try {
    const response = await fetch(`${BASE_URL}/api/paypal-transfer/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        amount: 0.005, // Less than minimum $0.01
        note: 'Invalid amount test'
      })
    });

    const data = await response.json();
    
    if (!data.success && data.message.includes('Transfer amount must be at least $0.01')) {
      logSuccess('Invalid amount validation working correctly');
      return true;
    } else {
      logError(`Invalid amount validation failed. Expected validation error, got: ${data.message}`);
      return false;
    }
  } catch (error) {
    logError(`Invalid amount test error: ${error.message}`);
    return false;
  }
}

async function testUnauthorizedAccess() {
  logInfo('Testing unauthorized access...');
  
  try {
    const response = await fetch(`${BASE_URL}/api/paypal-transfer/history`, {
      method: 'GET'
      // No authorization header
    });

    const data = await response.json();
    
    if (!data.success && (data.message.includes('authentication') || data.message.includes('authorized') || data.message.includes('token'))) {
      logSuccess('Unauthorized access properly blocked');
      return true;
    } else {
      logError(`Unauthorized access not properly blocked. Expected auth error, got: ${data.message}`);
      return false;
    }
  } catch (error) {
    logError(`Unauthorized access test error: ${error.message}`);
    return false;
  }
}

async function runAllTests() {
  log('\n🚀 Starting PayPal Transfer API Tests...\n', 'bright');
  
  // Test 1: Admin Login
  const token = await testAdminLogin();
  if (!token) {
    logError('Cannot proceed without admin token');
    return;
  }
  
  log('\n' + '='.repeat(50) + '\n');
  
  // Test 2: Create Transfer
  const transfer = await testCreateTransfer(token);
  
  log('\n' + '='.repeat(50) + '\n');
  
  // Test 3: Get Transfer History
  const history = await testGetTransferHistory(token);
  
  log('\n' + '='.repeat(50) + '\n');
  
  // Test 4: Invalid Amount Validation
  await testInvalidAmount(token);
  
  log('\n' + '='.repeat(50) + '\n');
  
  // Test 5: Unauthorized Access
  await testUnauthorizedAccess();
  
  log('\n' + '='.repeat(50) + '\n');
  
  // Summary
  log('\n📊 Test Summary:', 'bright');
  logInfo('All PayPal transfer API tests completed');
  logInfo('Check the results above for any errors');
  
  if (transfer && history) {
    logSuccess('Core functionality working correctly');
  } else {
    logWarning('Some tests may have failed - check the output above');
  }
  
  log('\n🎯 Next Steps:', 'bright');
  logInfo('1. Test the admin interface at http://localhost:5174/paypal-transfer');
  logInfo('2. Login with admin credentials and create transfers');
  logInfo('3. Verify transfer history updates in real-time');
  logInfo('4. For production, upgrade to newer PayPal SDK with payouts support');
  
  log('\n✨ PayPal Transfer Implementation Complete! ✨\n', 'bright');
}

// Run tests if this script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runAllTests().catch(error => {
    logError(`Test suite failed: ${error.message}`);
    process.exit(1);
  });
}

export { runAllTests, testAdminLogin, testCreateTransfer, testGetTransferHistory }; 