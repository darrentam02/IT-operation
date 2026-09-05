// Applies only vendor_migration.sql against the live database (idempotent,
// non-destructive). Mirrors the pg wiring in migrate.mjs.
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { loadEnvFile } from "node:process";

const here = dirname(fileURLToPath(import.meta.url));

const candidates = [
  resolve(".env"),
  resolve(here, "..", "..", ".env"),
  resolve(here, "..", "..", "..", ".env"),
];
for (const c of candidates) if (existsSync(c)) loadEnvFile(c);

const args = process.argv.slice(2);
const argUrl = args.find((a) => a.startsWith("postgres") || a.startsWith("postgresql"));
let url = process.env.DATABASE_URL;
if (argUrl) url = argUrl;
if (!url) {
  console.error("DATABASE_URL is required (set it or pass it as argv[2]).");
  process.exit(2);
}

const { default: pg } = await import("pg");
const { Client } = pg;

function splitStatements(sql) {
  const out = [];
  let cur = "";
  let i = 0;
  const n = sql.length;
  const flush = () => { const s = cur.trim(); if (s) out.push(s); cur = ""; };
  while (i < n) {
    const ch = sql[i];
    const next = sql[i + 1];
    if (ch === "-" && next === "-") { let j = i + 2; while (j < n && sql[j] !== "\n") j++; cur += sql.slice(i, j + 1); i = j + 1; continue; }
    if (ch === "/" && next === "*") { let j = sql.indexOf("*/", i + 2); j = j === -1 ? n : j + 2; cur += sql.slice(i, j); i = j; continue; }
    if (ch === "'") { let j = i + 1; while (j < n) { if (sql[j] === "'") { if (sql[j + 1] === "'") { j += 2; continue; } j++; break; } j++; } cur += sql.slice(i, j); i = j; continue; }
    if (ch === '"') { let j = i + 1; while (j < n && sql[j] !== '"') j++; j = Math.min(j + 1, n); cur += sql.slice(i, j); i = j; continue; }
    if (ch === "$" && next === "$") { let j = i + 2; const end = sql.indexOf("$$", j); const close = end === -1 ? n : end + 2; cur += sql.slice(i, close); i = close; continue; }
    if (ch === ";") { cur += ";"; flush(); i++; continue; }
    cur += ch; i++;
  }
  flush();
  return out;
}

const client = new Client({
  connectionString: url,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 20000,
});
await client.connect();
console.log("Connected.");

const raw = readFileSync(resolve(here, "sql", "vendor_migration.sql"), "utf8");
const stmts = splitStatements(raw);
console.log(`vendor_migration.sql -> ${stmts.length} statements`);

let ok = 0;
for (let idx = 0; idx < stmts.length; idx++) {
  try {
    await client.query(stmts[idx]);
    ok++;
  } catch (e) {
    console.error(`\n[FAIL] stmt ${idx + 1}/${stmts.length}: ${e.code} ${e.message.split("\n")[0]}`);
  }
}
console.log(`Applied ${ok}/${stmts.length} statements.`);
await client.end().catch(() => {});
