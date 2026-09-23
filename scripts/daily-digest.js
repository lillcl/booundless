#!/usr/bin/env node
/* Daily ops digest for the Service MVP pilot.
   Emits a single JSON line per run that the scheduled workflow can post to
   Slack or Resend. Safe to run against a read-only snapshot of the DB.

   Outputs:
     - v2 service requests awaiting approval (v2 contract)
     - requests stuck in started/in_progress for > 24h
     - service_completions awaiting owner confirm
     - disputes open with no response > 48h
     - CSP reports received in the last 24h
     - double-booking conflicts (booking_slots over capacity)
     - payment reconciliation: paid vs commission_entries accrual

   Optional: set DIGEST_WEBHOOK_URL to POST the JSON summary to a Slack
   incoming webhook (or any URL accepting { text: ... }). The script never
   blocks on this — failures log and exit non-zero so the cron alerts. */

import { config as loadDotenv } from 'dotenv';
loadDotenv();

import pg from 'pg';

const DB_URL = process.env.SUPABASE_DB_URL || process.env.KC_DATABASE_URL;
if (!DB_URL) { console.error('SUPABASE_DB_URL or KC_DATABASE_URL required'); process.exit(2); }

function summariseForSlack(report) {
  const lines = [];
  lines.push(`*BOOUNDLESS Service MVP — daily digest (${new Date(report.generated_at).toISOString().slice(0,10)})*`);
  lines.push(`• Awaiting approval: ${report.awaiting_approval_count}`);
  if (report.stuck_in_progress.length) {
    lines.push(`• Stuck in-progress (>24h): ${report.stuck_in_progress.length}`);
  }
  if (report.awaiting_owner_confirm.length) {
    lines.push(`• Awaiting owner confirm (>12h): ${report.awaiting_owner_confirm.length}`);
  }
  if (report.stale_cases.length) {
    lines.push(`• Stale service cases (>48h): ${report.stale_cases.length}`);
  }
  if (report.overbooked_slots.length) {
    lines.push(`• *Overbooked slots:* ${report.overbooked_slots.length}`);
  }
  lines.push(`• CSP reports (24h): ${report.csp_reports_24h.count} across ${report.csp_reports_24h.pages} pages`);
  const paid = Number(report.reconciliation.paid_total || 0);
  const refund = Number(report.reconciliation.refund_total || 0);
  const comm = Number(report.reconciliation.commission_accrued || 0);
  const rev = Number(report.reconciliation.commission_reversed || 0);
  lines.push(`• Paid: ${paid} minor · Refunded: ${refund} minor · Commission accrued: ${comm} · Reversed: ${rev}`);
  return lines.join('\n');
}

async function postWebhook(url, body) {
  const slackPayload = { text: body };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(slackPayload),
  });
  if (!res.ok) throw new Error(`Webhook responded ${res.status}: ${await res.text()}`);
}

async function main() {
  const webhookUrl = process.env.DIGEST_WEBHOOK_URL || null;
  const pool = new pg.Pool({ connectionString: DB_URL, max: 2 });
  const c = await pool.connect();
  let report;
  try {
    const awaitingApproval = (await c.query(`
      SELECT id, order_number, created_at, currency, approved_total_minor
        FROM dealer_service_requests
       WHERE workflow_version=2 AND status IN ('new','quoted')
         AND created_at < NOW() - INTERVAL '4 hours'
       ORDER BY created_at LIMIT 50
    `)).rows;
    const stuck = (await c.query(`
      SELECT id, order_number, started_at, EXTRACT(EPOCH FROM (NOW() - started_at))/3600 AS hours
        FROM dealer_service_requests
       WHERE work_state='in_progress' AND started_at < NOW() - INTERVAL '24 hours'
       ORDER BY started_at LIMIT 50
    `)).rows;
    const awaitingConfirm = (await c.query(`
      SELECT id, order_number, completed_at, EXTRACT(EPOCH FROM (NOW() - completed_at))/3600 AS hours
        FROM dealer_service_requests
       WHERE work_state='completion_submitted'
         AND completed_at < NOW() - INTERVAL '12 hours'
       ORDER BY completed_at LIMIT 50
    `)).rows;
    const openCases = (await c.query(`
      SELECT id, request_id, kind, created_at, EXTRACT(EPOCH FROM (NOW() - created_at))/3600 AS hours
        FROM service_cases WHERE status IN ('open','in_review')
          AND created_at < NOW() - INTERVAL '48 hours'
       ORDER BY created_at LIMIT 50
    `)).rows;
    const csp24h = (await c.query(`
      SELECT count(*)::int AS count, COUNT(DISTINCT document_uri)::int AS pages
        FROM csp_reports WHERE received_at > NOW() - INTERVAL '24 hours'
    `)).rows[0];
    const overbooked = (await c.query(`
      SELECT bs.id, bs.branch_id, bs.starts_at, bs.capacity,
             (SELECT COUNT(*)::int FROM service_bookings sb
              WHERE sb.slot_id=bs.id AND sb.status='confirmed') AS booked
        FROM booking_slots bs
       WHERE bs.starts_at > NOW() AND bs.starts_at < NOW() + INTERVAL '14 days'
         AND (SELECT COUNT(*)::int FROM service_bookings sb
              WHERE sb.slot_id=bs.id AND sb.status='confirmed') > bs.capacity
       LIMIT 50
    `)).rows;
    const recon = (await c.query(`
      SELECT
        (SELECT COALESCE(SUM(amount_minor),0)::bigint FROM service_payment_events WHERE type='payment') AS paid_total,
        (SELECT COALESCE(SUM(amount_minor),0)::bigint FROM service_payment_events WHERE type='refund') AS refund_total,
        (SELECT COALESCE(SUM(commission_minor),0)::bigint FROM commission_entries WHERE entry_type='accrual') AS commission_accrued,
        (SELECT COALESCE(SUM(commission_minor),0)::bigint FROM commission_entries WHERE entry_type='reversal') AS commission_reversed
    `)).rows[0];

    report = {
      generated_at: new Date().toISOString(),
      pilot_window_days: 30,
      awaiting_approval_count: awaitingApproval.length,
      awaiting_approval: awaitingApproval,
      stuck_in_progress: stuck,
      awaiting_owner_confirm: awaitingConfirm,
      stale_cases: openCases,
      csp_reports_24h: csp24h,
      overbooked_slots: overbooked,
      reconciliation: recon,
    };
  } finally {
    c.release();
    await pool.end();
  }
  console.log(JSON.stringify(report, null, 2));
  if (webhookUrl) {
    try {
      await postWebhook(webhookUrl, summariseForSlack(report));
      console.log(`---\nPosted Slack digest to ${webhookUrl.replace(/\/.+$/, '')}`);
    } catch (e) {
      console.error('Webhook post failed:', e.message);
      process.exitCode = 1;
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });