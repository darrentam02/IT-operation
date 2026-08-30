#!/usr/bin/env node
/*
 * Apply schema.sql + seed.sql to a live Supabase Postgres via node pg.
 * Usage: node apply-supabase.mjs <DATABASE_URL>
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const url = process.argv[2];
if (!url) {
  console.error('Usage: node apply-supabase.mjs <DATABASE_URL>');
  process.exit(2);
}

const here = dirname(fileURLToPath(import.meta.url));
const schema = await readFile(join(here, 'sql', 'schema.sql'), 'utf8');
const seed = await readFile(join(here, 'sql', 'seed.sql'), 'utf8');

const { default: pg } = await import('pg');
const { Client } = pg;

const client = new Client({
  connectionString: url,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 20000,
});

async function run(label, sql) {
  const t0 = Date.now();
  const res = await client.query(sql);
  console.log(`[OK] ${label} (${Date.now() - t0}ms) commandCount=${res.command?.length ?? '?'}`);
  return res;
}

try {
  await client.connect();
  console.log('Connected.');
  await run('SCHEMA (CREATE TABLE/RLS/triggers)', schema);
  await run('SEED (teams/profiles/vendors/financials)', seed);
  console.log('\nALL DONE');
} catch (e) {
  console.error('\nFAILED:', e.code || '', e.message);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
