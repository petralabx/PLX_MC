import pg from "pg";

const c = new pg.Client({
  connectionString: process.env.PLX_MC_DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await c.connect();
const r = await c.query("SELECT * FROM sync_boring_gate WHERE id = 1");
console.log(JSON.stringify(r.rows[0] ?? null, null, 2));
await c.end();
