/** Sign-up, sign-in and session identity (PRD FR-S5). */
import { Router } from 'express';
import { z } from 'zod';
import { query, queryOne } from '../db/index.js';
import {
  authenticate,
  hashPassword,
  signToken,
  verifyPassword,
} from '../middleware/auth.js';
import { ApiError, conflict } from '../middleware/errors.js';

const router = Router();

const credentials = z.object({
  email: z.email('Enter a valid email address.').transform((value) => value.trim().toLowerCase()),
  password: z.string().min(8, 'Use at least 8 characters.'),
});

const registration = credentials.extend({
  name: z.string().trim().min(2, 'Enter your name.').max(120),
  phone: z.string().trim().max(20).optional(),
});

const publicUser = (row) => ({
  id: Number(row.id),
  name: row.name,
  email: row.email,
  role: row.role,
  phone: row.phone ?? null,
});

/**
 * Self-service registration creates commuters only. Driver and administrator
 * accounts are provisioned by an admin (FR-A1) so nobody can grant themselves
 * the ability to publish check-ins or read the planning dashboard.
 */
router.post('/register', async (req, res) => {
  const input = registration.parse(req.body);

  const existing = await queryOne('SELECT id FROM users WHERE email = $1', [input.email]);
  if (existing) throw conflict('An account with that email already exists.');

  const row = await queryOne(
    `INSERT INTO users (name, email, password_hash, role, phone)
     VALUES ($1, $2, $3, 'commuter', $4)
     RETURNING id, name, email, role, phone`,
    [input.name, input.email, await hashPassword(input.password), input.phone ?? null],
  );

  res.status(201).json({ token: signToken(row), user: publicUser(row) });
});

router.post('/login', async (req, res) => {
  const input = credentials.parse(req.body);

  const row = await queryOne(
    'SELECT id, name, email, role, phone, password_hash, is_active FROM users WHERE email = $1',
    [input.email],
  );

  // One message for both "no such user" and "wrong password" so the endpoint
  // cannot be used to enumerate registered addresses.
  const ok = row && (await verifyPassword(input.password, row.password_hash));
  if (!ok) throw new ApiError(401, 'Email or password is incorrect.');
  if (!row.is_active) throw new ApiError(403, 'This account has been deactivated.');

  res.json({ token: signToken(row), user: publicUser(row) });
});

router.get('/me', authenticate, async (req, res) => {
  const row = await queryOne(
    'SELECT id, name, email, role, phone FROM users WHERE id = $1 AND is_active = TRUE',
    [req.user.id],
  );
  if (!row) throw new ApiError(401, 'Account no longer available.');
  res.json({ user: publicUser(row) });
});

router.post('/password', authenticate, async (req, res) => {
  const input = z
    .object({
      currentPassword: z.string().min(1, 'Enter your current password.'),
      newPassword: z.string().min(8, 'Use at least 8 characters.'),
    })
    .parse(req.body);

  const row = await queryOne('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
  if (!row || !(await verifyPassword(input.currentPassword, row.password_hash))) {
    throw new ApiError(401, 'Current password is incorrect.');
  }

  await query('UPDATE users SET password_hash = $2 WHERE id = $1', [
    req.user.id,
    await hashPassword(input.newPassword),
  ]);
  res.status(204).end();
});

export default router;
