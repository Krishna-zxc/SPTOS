/**
 * The Express application (PRD FR-S2, FR-S3, FR-S5).
 *
 * Kept separate from index.js so tests can mount the app over PGlite with
 * supertest without opening a port or starting a Socket.io server.
 *
 * The four routers mirror the PRD's own division of labour: catalog and live for
 * commuters, driver for check-ins, admin for planning.
 */
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import config from './config.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';
import { rateLimit, startRateLimitSweeper } from './middleware/ratelimit.js';
import authRoutes from './routes/auth.routes.js';
import catalogRoutes from './routes/catalog.routes.js';
import liveRoutes from './routes/live.routes.js';
import driverRoutes from './routes/driver.routes.js';
import adminRoutes from './routes/admin.routes.js';

export function createApp() {
  const app = express();

  // Behind Render/Railway's proxy, req.ip is the load balancer without this,
  // which would make the rate limiter treat every client as one caller.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(cors({ origin: config.corsOrigin, credentials: true }));
  app.use(express.json({ limit: '256kb' }));
  if (!config.isTest) app.use(morgan(config.isProduction ? 'combined' : 'dev'));

  /** Liveness probe for the free-tier host, and a hint at which driver is live. */
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, env: config.env, uptimeSeconds: Math.round(process.uptime()) });
  });

  // Credential endpoints are the only ones worth guessing against.
  app.use('/api/auth', rateLimit({ windowMs: 60_000, max: 20 }), authRoutes);
  app.use('/api', catalogRoutes);
  app.use('/api', liveRoutes);
  app.use('/api/driver', driverRoutes);
  app.use('/api/admin', adminRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  startRateLimitSweeper();
  return app;
}

export default createApp;
