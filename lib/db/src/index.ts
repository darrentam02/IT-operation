import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

const _dbUrl = process.env.SUPABASE_DATABASE_URL || process.env.DATABASE_URL;
if (!_dbUrl) {
  throw new Error(
    "SUPABASE_DATABASE_URL or DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// Supabase's pooler terminates TLS and its cert chain is not in Node's default
// trust store, so we connect with relaxed TLS by default. Deployments pointing
// at a plaintext local Postgres can opt out with DB_CONNECT_TLS=false.
const tlsEnabled = process.env.DB_CONNECT_TLS !== "false";
const poolOptions: pg.PoolConfig = {
  connectionString: _dbUrl,
  ...(tlsEnabled ? { ssl: { rejectUnauthorized: false } } : {}),
};

export const pool = new Pool(poolOptions);
export const db = drizzle(pool, { schema });

export * from "./schema";
