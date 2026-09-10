import { randomUUID } from 'node:crypto';
import { getDb } from '../_lib/db.js';
import { text, toolResult } from '../_lib/tool-utils.js';

export const profileTools = {
  get_user_preferences: {
    description: 'Read the current user notification preferences.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
    readOnly: true,
    async execute({ user }) {
      const db = await getDb(); const r = await db.query(`INSERT INTO user_notification_preferences (user_id) VALUES ($1)
        ON CONFLICT (user_id) DO UPDATE SET user_id=EXCLUDED.user_id RETURNING user_id,maintenance_reminders,trip_updates,ai_suggestions,updated_at`, [user.id]);
      return toolResult(r.rows[0]);
    },
  },
  create_support_ticket: {
    description: 'Create a support ticket only after user confirmation.',
    write: true,
    input_schema: { type: 'object', required: ['subject', 'message'], properties: { subject: { type: 'string' }, message: { type: 'string' } }, additionalProperties: false },
    async execute({ args, user }) {
      const subject = text(args.subject, 'subject', { required: true, max: 200 }); const message = text(args.message, 'message', { required: true, max: 4000 }); const db = await getDb();
      const r = await db.query('INSERT INTO support_tickets (id,user_id,subject,message) VALUES ($1,$2,$3,$4) RETURNING id,subject,message,status,created_at', [randomUUID(),user.id,subject,message]);
      return toolResult(r.rows[0]);
    },
  },
  update_notification_preferences: {
    description: 'Change notification preferences only after user confirmation.',
    write: true,
    input_schema: { type: 'object', properties: { maintenance_reminders: { type: 'boolean' }, trip_updates: { type: 'boolean' }, ai_suggestions: { type: 'boolean' } }, additionalProperties: false },
    async execute({ args, user }) {
      const keys = ['maintenance_reminders','trip_updates','ai_suggestions']; if (!keys.some((key) => args[key] !== undefined)) throw new Error('At least one preference is required');
      for (const key of keys) if (args[key] !== undefined && typeof args[key] !== 'boolean') throw new Error(`${key} must be boolean`);
      const db = await getDb(); const current = await db.query('SELECT maintenance_reminders,trip_updates,ai_suggestions FROM user_notification_preferences WHERE user_id=$1', [user.id]); const old = current.rows[0] || { maintenance_reminders: true, trip_updates: true, ai_suggestions: true };
      const values = keys.map((key) => args[key] === undefined ? old[key] : args[key]);
      const r = await db.query(`INSERT INTO user_notification_preferences (user_id,maintenance_reminders,trip_updates,ai_suggestions)
        VALUES ($1,$2,$3,$4) ON CONFLICT (user_id) DO UPDATE SET maintenance_reminders=$2,trip_updates=$3,ai_suggestions=$4,updated_at=NOW()
        RETURNING user_id,maintenance_reminders,trip_updates,ai_suggestions,updated_at`, [user.id, ...values]);
      return toolResult(r.rows[0]);
    },
  },
};
