/**
 * Authentication and role-based access control (PRD FR-S5).
 *
 * Access tokens are stateless JWTs carrying the user id and role. Every
 * protected route declares the roles it accepts, so authorisation is visible at
 * the route definition rather than buried in handlers.
 */
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import config from '../config.js';
import { ApiError } from './errors.js';

const BCRYPT_ROUNDS = 10;

export const hashPassword = (plain) => bcrypt.hash(plain, BCRYPT_ROUNDS);
export const verifyPassword = (plain, hash) => bcrypt.compare(plain, hash);

export function signToken(user) {
  return jwt.sign({ sub: String(user.id), role: user.role, name: user.name }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
  });
}

export function verifyToken(token) {
  const payload = jwt.verify(token, config.jwtSecret);
  return { id: Number(payload.sub), role: payload.role, name: payload.name };
}

function readBearer(req) {
  const header = req.get('authorization') || '';
  const [scheme, token] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' && token ? token : null;
}

/** Populates req.user when a valid token is present; never rejects. */
export function optionalAuth(req, _res, next) {
  const token = readBearer(req);
  if (token) {
    try {
      req.user = verifyToken(token);
    } catch {
      // An expired or malformed token on a public route is simply ignored.
    }
  }
  next();
}

/** Rejects the request unless a valid token is present. */
export function authenticate(req, _res, next) {
  const token = readBearer(req);
  if (!token) return next(new ApiError(401, 'Sign in to continue.'));
  try {
    req.user = verifyToken(token);
    return next();
  } catch (err) {
    const expired = err?.name === 'TokenExpiredError';
    return next(new ApiError(401, expired ? 'Session expired — sign in again.' : 'Invalid token.'));
  }
}

/** Route guard: `requireRole('admin')`, `requireRole('driver', 'admin')`. */
export function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.user) return next(new ApiError(401, 'Sign in to continue.'));
    if (!roles.includes(req.user.role)) {
      return next(new ApiError(403, `This action requires the ${roles.join(' or ')} role.`));
    }
    return next();
  };
}
