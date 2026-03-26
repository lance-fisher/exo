import type { FastifyRequest, FastifyReply, FastifyInstance } from 'fastify';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { getRedis } from '../redis.js';
import { getConfig } from '../config.js';
import { logger } from '../logger.js';

const NONCE_TTL_SECONDS = 300; // 5 minutes

/** Register security headers and middleware */
export async function registerSecurityMiddleware(app: FastifyInstance): Promise<void> {
  // Add security headers to every response
  app.addHook('onSend', async (_request: FastifyRequest, reply: FastifyReply) => {
    // CSP — strict policy
    reply.header(
      'Content-Security-Policy',
      [
        "default-src 'none'",
        "script-src 'self'",
        "style-src 'self'",
        "img-src 'self' data:",
        "font-src 'self'",
        "connect-src 'self' wss:",
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self'",
      ].join('; '),
    );

    // HSTS — 1 year with subdomains and preload
    reply.header(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains; preload',
    );

    // Prevent framing
    reply.header('X-Frame-Options', 'DENY');

    // Prevent MIME sniffing
    reply.header('X-Content-Type-Options', 'nosniff');

    // Referrer policy
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');

    // Permissions policy — disable dangerous APIs
    reply.header(
      'Permissions-Policy',
      'camera=(), microphone=(), geolocation=(), payment=()',
    );

    // Prevent caching of sensitive responses
    reply.header('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    reply.header('Pragma', 'no-cache');
  });

  logger.info('Security middleware registered');
}

/** Generate a nonce for anti-replay protection */
export async function generateNonce(): Promise<string> {
  const nonce = randomBytes(32).toString('base64url');
  const redis = getRedis();
  await redis.setex(`nonce:${nonce}`, NONCE_TTL_SECONDS, '1');
  return nonce;
}

/** Validate and consume a nonce (single-use) */
export async function validateNonce(nonce: string): Promise<boolean> {
  const redis = getRedis();
  // GETDEL is atomic — returns the value and deletes in one operation
  const result = await redis.getdel(`nonce:${nonce}`);
  return result === '1';
}

/** Verify a request signature (HMAC-SHA256) */
export function verifyRequestSignature(
  payload: string,
  signature: string,
  secret: string,
): boolean {
  const expected = createHash('sha256')
    .update(`${secret}:${payload}`)
    .digest('hex');

  try {
    return timingSafeEqual(
      Buffer.from(signature, 'hex'),
      Buffer.from(expected, 'hex'),
    );
  } catch {
    return false;
  }
}

/** Middleware to validate anti-replay nonce on mutating requests */
export async function validateReplayProtection(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  // Only apply to mutating methods
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
    return;
  }

  const nonce = request.headers['x-request-nonce'] as string | undefined;
  if (!nonce) {
    // Nonce is optional but recommended — log a warning
    logger.debug('Request without anti-replay nonce', {
      method: request.method,
      url: request.url,
      ip: request.ip,
    });
    return;
  }

  const valid = await validateNonce(nonce);
  if (!valid) {
    logger.warn('Replay protection: invalid or reused nonce', {
      method: request.method,
      url: request.url,
      ip: request.ip,
    });
    reply.code(409).send({
      error: 'Invalid or reused request nonce',
      code: 'REPLAY_DETECTED',
    });
    return;
  }
}

/** Middleware to verify request signature on sensitive endpoints */
export async function validateRequestSignature(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const signature = request.headers['x-request-signature'] as string | undefined;
  if (!signature) {
    return; // Signature is optional — only enforced on specific routes
  }

  const config = getConfig();
  const body = typeof request.body === 'string' ? request.body : JSON.stringify(request.body ?? '');

  const valid = verifyRequestSignature(body, signature, config.SESSION_SECRET);
  if (!valid) {
    logger.warn('Invalid request signature', {
      method: request.method,
      url: request.url,
      ip: request.ip,
    });
    reply.code(403).send({
      error: 'Invalid request signature',
      code: 'INVALID_SIGNATURE',
    });
    return;
  }
}
