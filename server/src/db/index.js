/**
 * Data-layer adapter (PRD FR-S3).
 *
 * SPTOS targets PostgreSQL. To keep the pilot free of local setup, the server
 * falls back to PGlite — real PostgreSQL compiled to WebAssembly and run
 * in-process — whenever DATABASE_URL is empty. Both drivers speak the same SQL
 * dialect and the same `$1` placeholder style, so nothing above this module
 * needs to know which one is active.
 */
import config from '../config.js';

let driver = null;

async function createPgDriver(connectionString) {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({
    connectionString,
    // Managed free-tier Postgres (Neon/Render/Supabase) requires TLS but uses
    // certificates Node does not ship a root for.
    ssl: /\bsslmode=(require|verify-full)\b/.test(connectionString)
      ? { rejectUnauthorized: false }
      : undefined,
    max: 10,
  });
  pool.on('error', (err) => console.error('[db] idle client error:', err.message));

  return {
    name: 'postgres',
    async query(sql, params = []) {
      const result = await pool.query(sql, params);
      return { rows: result.rows, rowCount: result.rowCount ?? result.rows.length };
    },
    async exec(sql) {
      await pool.query(sql);
    },
    async withTransaction(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const value = await fn({
          async query(sql, params = []) {
            const result = await client.query(sql, params);
            return { rows: result.rows, rowCount: result.rowCount ?? result.rows.length };
          },
        });
        await client.query('COMMIT');
        return value;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
    async close() {
      await pool.end();
    },
  };
}
async function createPgliteDriver() {
  const { PGlite } = await import('@electric-sql/pglite');
  // Tests get a throwaway in-memory database; dev persists under .pgdata/ so
  // seeded routes survive a restart.
  const dataDir = config.isTest ? 'memory://sptos-test' : config.pgliteDataDir;
  const db = await PGlite.create(dataDir);

  const normalise = (result) => ({
    rows: result.rows ?? [],
    rowCount: result.affectedRows ?? (result.rows ? result.rows.length : 0),
  });

  return {
    name: 'pglite',
    dataDir,
    async query(sql, params = []) {
      return normalise(await db.query(sql, params));
    },
    async exec(sql) {
      await db.exec(sql);
    },
    async withTransaction(fn) {
      return db.transaction(async (tx) =>
        fn({
          async query(sql, params = []) {
            return normalise(await tx.query(sql, params));
          },
        }),
      );
    },
    async close() {
      await db.close();
    },
  };
}

/** Opens the connection on first use; later calls reuse the same driver. */
export async function getDb() {
  if (!driver) {
    driver = config.databaseUrl
      ? await createPgDriver(config.databaseUrl)
      : await createPgliteDriver();
    if (!config.isTest) {
      console.log(
        driver.name === 'postgres'
          ? '[db] connected to PostgreSQL via DATABASE_URL'
          : `[db] using embedded PGlite (${driver.dataDir}) — set DATABASE_URL for a real Postgres`,
      );
    }
  }
  return driver;
}

/** Runs a parameterised statement. Never interpolate values into `sql`. */
export async function query(sql, params = []) {
  const db = await getDb();
  return db.query(sql, params);
}

/** Convenience: first row, or null. */
export async function queryOne(sql, params = []) {
  const { rows } = await query(sql, params);
  return rows[0] ?? null;
}

/** Runs a multi-statement script (migrations only). */
export async function exec(sql) {
  const db = await getDb();
  return db.exec(sql);
}

/** Runs `fn` inside a transaction, rolling back if it throws. */
export async function withTransaction(fn) {
  const db = await getDb();
  return db.withTransaction(fn);
}

export async function closeDb() {
  if (driver) {
    await driver.close();
    driver = null;
  }
}

export default { getDb, query, queryOne, exec, withTransaction, closeDb };

