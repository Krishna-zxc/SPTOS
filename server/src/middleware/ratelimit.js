/**
 * A small in-process rate limiter for the credential endpoints.
 *
 * §13 rules out paid infrastructure, so there is no Redis to share counters
 * with — this is per-process and resets on restart. That is honest about what it
 * is: enough to blunt a script guessing passwords against the pilot, not a
 * defence for a horizontally scaled deployment. If SPTOS is ever run on more
 * than one instance, move this to a shared store.
 */
const buckets = new Map();

export function rateLimit({ windowMs = 60_000, max = 20, key = (req) => req.ip } = {}) {
  return (req, res, next) => {
    const now = Date.now();
    const id = key(req) ?? 'anonymous';
    const bucket = buckets.get(id);

    if (!bucket || bucket.resetAt <= now) {
      buckets.set(id, { count: 1, resetAt: now + windowMs });
      return next();
    }

    bucket.count += 1;
    if (bucket.count > max) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      res.set('retry-after', String(retryAfter));
      return res.status(429).json({ error: 'Too many attempts. Try again shortly.', retryAfter });
    }

    return next();
  };
}

/** Drops expired buckets so a long-running process does not accumulate keys. */
export function startRateLimitSweeper(intervalMs = 300_000) {
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [id, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(id);
  }, intervalMs);
  timer.unref();
  return timer;
}
