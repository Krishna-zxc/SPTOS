/** HTTP error plumbing: one error shape for every failure the API returns. */
import { ZodError } from 'zod';
import config from '../config.js';

export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    if (details) this.details = details;
  }
}

export const badRequest = (message, details) => new ApiError(400, message, details);
export const notFoundError = (what = 'Resource') => new ApiError(404, `${what} not found.`);
export const conflict = (message) => new ApiError(409, message);

/** Terminal 404 for unmatched paths. */
export function notFoundHandler(req, _res, next) {
  next(new ApiError(404, `No API route for ${req.method} ${req.originalUrl}`));
}

/**
 * Final error handler. Validation failures become 400s with per-field detail;
 * unique-constraint violations become 409s; anything unrecognised is logged and
 * reported as a 500 without leaking internals to the client.
 */
export function errorHandler(err, _req, res, _next) {
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: 'Some fields need attention.',
      details: err.issues.map((issue) => ({
        field: issue.path.join('.') || '(body)',
        message: issue.message,
      })),
    });
  }

  if (err instanceof ApiError) {
    return res.status(err.status).json({
      error: err.message,
      ...(err.details ? { details: err.details } : {}),
    });
  }

  // 23505 = unique_violation, 23503 = foreign_key_violation
  if (err?.code === '23505') {
    return res.status(409).json({ error: 'That record already exists.' });
  }
  if (err?.code === '23503') {
    return res.status(400).json({ error: 'Referenced record does not exist.' });
  }

  console.error('[api] unhandled error:', err);
  return res.status(500).json({
    error: 'Something went wrong on our side.',
    ...(config.isProduction ? {} : { debug: err?.message }),
  });
}
