/**
 * Imported first by every test file.
 *
 * config.js reads NODE_ENV when it is evaluated, and that single value decides
 * whether the data layer opens the throwaway in-memory PGlite database or the
 * one under .pgdata/ that `npm run dev` is using. ES modules evaluate their
 * imports in source order, so importing this before anything else guarantees the
 * flag is set in time.
 */
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET ??= 'test-secret-not-used-anywhere-else';
process.env.DATABASE_URL = '';
