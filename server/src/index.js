/**
 * Server entry point.
 *
 * Migrations run on boot on purpose: the pilot is deployed from a free-tier host
 * with no release pipeline to run them from, and applying an already-applied
 * file is a no-op.
 */
import http from 'node:http';
import config from './config.js';
import { closeDb, getDb } from './db/index.js';
import { migrate } from './db/migrate.js';
import { createApp } from './app.js';
import { closeRealtime, initRealtime } from './services/realtime.js';

async function start() {
  const db = await getDb();
  await migrate({ log: false });

  const app = createApp();
  const server = http.createServer(app);
  initRealtime(server);

  await new Promise((resolve) => server.listen(config.port, resolve));
  console.log(`[sptos] listening on http://localhost:${config.port} (${config.env}, ${db.name})`);

  // Free-tier hosts stop instances with SIGTERM; finishing in-flight requests
  // keeps a driver's check-in from being lost to a routine redeploy.
  let closing = false;
  const shutdown = async (signal) => {
    if (closing) return;
    closing = true;
    console.log(`[sptos] ${signal} received, shutting down`);

    const forced = setTimeout(() => process.exit(1), 10_000);
    forced.unref();

    await closeRealtime();
    await new Promise((resolve) => server.close(resolve));
    await closeDb();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  return server;
}

start().catch((err) => {
  console.error('[sptos] failed to start:', err);
  process.exit(1);
});
