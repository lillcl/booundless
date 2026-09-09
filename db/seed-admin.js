/* Idempotent seed for the bootstrap admin user.
   Usage: node db/seed-admin.js
   Uses bcryptjs to hash 'admin123' (cost 10) and INSERT ... ON CONFLICT
   so the script is safe to re-run. */

import { config as loadDotenv } from 'dotenv';
loadDotenv();
import bcrypt from 'bcryptjs';
import pg from 'pg';

const URL = process.env.KC_DATABASE_URL;
if (!URL) { console.error('KC_DATABASE_URL not set'); process.exit(1); }

const ADMIN_EMAIL = 'admin@example.com';
const ADMIN_PASSWORD = 'admin123';

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
