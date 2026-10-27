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

async function main() {
  const hasSmtp = Boolean(
    process.env.SMTP_HOST?.trim() &&
      process.env.SMTP_USER?.trim() &&
      process.env.SMTP_PASS?.trim()
  );
  if (!hasSmtp) {
    console.error(
      '❌ SMTP is not configured. Set SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS in backend/.env first.'
    );
    console.error('   (See .env.example for the full list of email variables.)');
    process.exit(1);
  }

  const transportVerified = await emailService.transportReady;
  if (!transportVerified || !emailService.transporter) {
    console.error('❌ SMTP connection/authentication could not be verified (see categorized service status above).');
    process.exit(1);
  }

  console.log('✅ SMTP connection and authentication verified');

  const to = process.env.TEST_EMAIL_TO;
  if (to) {
    try {
      await emailService.sendEmail({
        to,
        subject: 'NovaCart email service test',
        template: 'welcome',
        variables: { name: 'Operator' },
      });
      console.log("✅ Test email accepted by SMTP using the real 'welcome' template.");
    } catch {
      console.error('❌ Test email could not be handed off to SMTP.');
      process.exit(1);
    }
  } else {
    console.log('ℹ️  SMTP verified. No email was sent because TEST_EMAIL_TO is unset.');
  }

  process.exit(0);
}

main().catch(() => {
  console.error('❌ SMTP diagnostic failed (details suppressed).');
  process.exit(1);
});
