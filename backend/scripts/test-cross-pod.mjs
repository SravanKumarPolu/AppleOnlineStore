
import { io } from 'socket.io-client';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const rl = readline.createInterface({ input, output });

let socket;

try {
  const customerToken = (
    await rl.question('Customer access token: ')
  ).trim();

  const adminToken = (
    await rl.question('Admin access token: ')
  ).trim();

  const orderId = (
    await rl.question('Test order ID: ')
  ).trim();

  const status = (
    await rl.question('New order status: ')
  ).trim();

  if (!customerToken || !adminToken || !orderId || !status) {
    throw new Error('All inputs are required');
  }

  socket = io('http://localhost:3002', {
    auth: { token: customerToken },
    transports: ['websocket'],
    reconnection: false,
    timeout: 10000,
    autoConnect: false,
  });

  const received = [];

  socket.on('order_updated', (event) => {
    if (String(event?._id) === orderId) {
      received.push(event);
      console.log('Matching order_updated event received');
    }
  });

  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Socket connection timeout')),
      12000
    );

    socket.once('connect', () => {
      clearTimeout(timer);
      resolve();
    });

    socket.once('connect_error', (error) => {
      clearTimeout(timer);
      reject(error);
    });

    socket.connect();
  });

  console.log('Customer connected directly to Pod A');

  const response = await fetch(
    'http://localhost:3003/api/orders/status',
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        token: adminToken,
      },
      body: JSON.stringify({ orderId, status }),
    }
  );

  if (!response.ok) {
    throw new Error(`Admin API returned HTTP ${response.status}`);
  }

  console.log('Admin update completed through Pod B');

  await new Promise((resolve) => setTimeout(resolve, 3000));

  console.log('Matching events received:', received.length);

  if (received.length !== 1) {
    throw new Error(
      `Expected exactly one event, received ${received.length}`
    );
  }

  console.log('PASS: Cross-Pod delivery received exactly once');

} catch (error) {
  console.error('TEST FAILED:', error.message);
  process.exitCode = 1;
} finally {
  socket?.disconnect();
  rl.close();
}
