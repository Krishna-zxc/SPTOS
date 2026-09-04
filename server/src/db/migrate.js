/**
 * Migration runner. Applies every .sql file in ./migrations in filename order
 * and records what it applied, so re-running is a no-op.
 *
 *   npm run migrate            (server workspace)
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { exec, query, closeDb } from './index.js';

const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

/** `log: false` silences the runner — used when boot or seeding owns the output. */
export async function migrate({ log = console.log } = {}) {
  const write = typeof log === 'function' ? log : () => {};

  await exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename    TEXT PRIMARY KEY,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  const files = (await fs.readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();
  const { rows } = await query('SELECT filename FROM schema_migrations');
  const applied = new Set(rows.map((r) => r.filename));

  let count = 0;
  for (const filename of files) {
    if (applied.has(filename)) continue;
    const sql = await fs.readFile(path.join(migrationsDir, filename), 'utf8');
    await exec(sql);
    await query('INSERT INTO schema_migrations (filename) VALUES ($1)', [filename]);
    write(`[migrate] applied ${filename}`);
    count += 1;
  }

  if (count === 0) write('[migrate] schema already up to date');
  return { applied: count, total: files.length };
}

// Run directly (`node src/db/migrate.js`) rather than imported.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  migrate()
    .then(() => closeDb())
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[migrate] failed:', err);
      process.exit(1);
    });
}
