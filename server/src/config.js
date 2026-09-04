import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(serverRoot, '.env'), quiet: true });

const num = (value, fallback) => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const env = process.env.NODE_ENV || 'development';

function resolveJwtSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  if (env === 'production') {
    throw new Error('JWT_SECRET must be set in production. See server/.env.example.');
  }
  // Dev/test only: an ephemeral secret keeps us from shipping a known key.
  // Tokens are invalidated whenever the server restarts.
  const generated = crypto.randomBytes(32).toString('hex');
  if (env !== 'test') {
    console.warn('[config] JWT_SECRET not set — generated an ephemeral development secret.');
  }
  return generated;
}

export const config = {
  env,
  isProduction: env === 'production',
  isTest: env === 'test',
  port: num(process.env.PORT, 4000),
  serverRoot,

  /** Empty string means "use the embedded PGlite database". */
  databaseUrl: process.env.DATABASE_URL || '',
  pgliteDataDir: path.join(serverRoot, '.pgdata'),

  jwtSecret: resolveJwtSecret(),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',

  corsOrigin: (process.env.CORS_ORIGIN || 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),

  staleAfterSeconds: num(process.env.STALE_AFTER_SECONDS, 480),
  minCheckinsForEta: num(process.env.MIN_CHECKINS_FOR_ETA, 1),
  etaMinSamples: num(process.env.ETA_MIN_SAMPLES, 3),
  etaFallbackSegmentSeconds: num(process.env.ETA_FALLBACK_SEGMENT_SECONDS, 180),
  arrivalAlertMinutes: num(process.env.ARRIVAL_ALERT_MINUTES, 5),
};

export default config;
