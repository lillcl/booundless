/* Idempotent seed for an admin user.
   Usage: ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD='…' node db/seed-admin.js
   The password is supplied at runtime, hashed with bcrypt, and never stored
   in source control or written to the database in plaintext. */

import { config as loadDotenv } from 'dotenv';
loadDotenv();
import bcrypt from 'bcryptjs';
import pg from 'pg';

const URL = process.env.SUPABASE_DB_URL || process.env.KC_DATABASE_URL;
if (!URL) { console.error('SUPABASE_DB_URL or KC_DATABASE_URL not set'); process.exit(1); }

const ADMIN_EMAIL = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.error('ADMIN_EMAIL and ADMIN_PASSWORD must be set at runtime');
  process.exit(1);
}

const hash = await bcrypt.hash(ADMIN_PASSWORD, 10);

const pool = new pg.Pool({ connectionString: URL, max: 2 });
const client = await pool.connect();
try {
  const r = await client.query(
    `INSERT INTO users (id, email, password_hash, role, display_name)
     VALUES ($1, $2, $3, 'admin', $4)
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash,
                                       role          = 'admin',
                                       display_name  = EXCLUDED.display_name,
                                       is_active     = TRUE,
                                       updated_at    = NOW()
     RETURNING id, email, role, created_at`,
    ['u-admin-bootstrap', ADMIN_EMAIL, hash, 'Bootstrap Admin'],
  );
  console.log('Admin user upserted:');
  console.log(JSON.stringify(r.rows[0], null, 2));
} finally {
  client.release();
  await pool.end();
}
