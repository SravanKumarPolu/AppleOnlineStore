#!/usr/bin/env node
// scripts/test-email.js (K-7 fix) — REAL email service test.
//
// Previously `npm run email:test` pointed at a file that did not exist
// (K-7). This script reuses the existing emailService — no new
// architecture — and does exactly what operators need:
//   1. Loads .env, initializes the real SMTP transporter
//   2. Verifies the SMTP connection (transporter.verify)
//   3. Optionally sends a test email using the real welcome template when
//      TEST_EMAIL_TO is set (never sends otherwise)
//
// Exit codes: 0 = SMTP connection verified; 1 = verification failed or
// configuration missing. Safe by default: without TEST_EMAIL_TO nothing is
// sent to anyone.
import 'dotenv/config';
import emailService from '../services/emailService.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // The service initializes its transporter asynchronously in the
  // constructor; give it a moment before verifying.
  await sleep(500);

  const hasSmtp = Boolean(process.env.SMTP_HOST && process.env.SMTP_USER);
  if (!hasSmtp) {
    console.error(
      '❌ SMTP is not configured. Set SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS in backend/.env first.'
    );
    console.error('   (See .env.example for the full list of email variables.)');
    process.exit(1);
  }

  if (!emailService.transporter) {
    console.error('❌ Email service failed to initialize (see errors above).');
    process.exit(1);
  }

  try {
    await emailService.transporter.verify();
    console.log('✅ SMTP connection verified:', process.env.SMTP_HOST, 'port', process.env.SMTP_PORT || 587);
  } catch (error) {
    console.error('❌ SMTP verification failed:', error.message);
    process.exit(1);
  }

  const to = process.env.TEST_EMAIL_TO;
  if (to) {
    try {
      await emailService.sendEmail({
        to,
        subject: 'NovaCart email service test',
        template: 'welcome',
        variables: { name: 'Operator' },
      });
      console.log(`✅ Test email sent to ${to} using the real 'welcome' template.`);
    } catch (error) {
      console.error(`❌ Failed to send test email to ${to}:`, error.message);
      process.exit(1);
    }
  } else {
    console.log('ℹ️  SMTP verified. Set TEST_EMAIL_TO=<address> to also send a test email.');
  }

  process.exit(0);
}

main().catch((error) => {
  console.error('❌ Unexpected error:', error.message);
  process.exit(1);
});
