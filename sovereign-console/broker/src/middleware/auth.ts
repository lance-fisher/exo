import type { FastifyRequest, FastifyReply } from 'fastify';
import { validateSession } from '../auth/session.js';
import { isDeviceEnrolled } from '../device-trust/index.js';
import { validateApprovalToken } from '../approval/index.js';
import { getRedis } from '../redis.js';
import { logger } from '../logger.js';
import type { AuthContext } from '../types/index.js';

// Augment Fastify request with auth context
declare module 'fastify' {
  interface FastifyRequest {
    authContext?: AuthContext;
  }
}

const SESSION_COOKIE_NAME = 'sovereign_session';

/** Extract session token from secure cookie */
function extractSessionToken(request: FastifyRequest): string | null {
  const cookies = request.cookies;
  if (cookies && typeof cookies[SESSION_COOKIE_NAME] === 'string') {
    return cookies[SESSION_COOKIE_NAME] || null;
  }
  return null;
}

/** Require a valid, authenticated session bound to an enrolled device */
export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const token = extractSessionToken(request);
  if (!token) {
    reply.code(401).send({ error: 'Authentication required', code: 'NO_SESSION' });
    return;
  }

  const session = await validateSession(token);
  if (!session) {
    reply.code(401).send({ error: 'Session expired or invalid', code: 'INVALID_SESSION' });
    return;
  }

  // Verify device is still enrolled
  const enrolled = await isDeviceEnrolled(session.device_id);
  if (!enrolled) {
    reply.code(403).send({ error: 'Device no longer enrolled', code: 'DEVICE_REVOKED' });
    return;
  }

  // Check session auth flags from Redis
  const redis = getRedis();
  const passkeyVerified = await redis.get(`session:passkey:${session.id}`);
  const totpVerified = await redis.get(`session:totp:${session.id}`);

  request.authContext = {
    operator_id: session.operator_id,
    device_id: session.device_id,
    session_id: session.id,
    session_expires_at: new Date(session.expires_at),
    passkey_verified: passkeyVerified === '1',
    totp_verified: totpVerified === '1',
  };
}

/** Require that the current session was authenticated via passkey */
export async function requirePasskey(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  await requireAuth(request, reply);
  if (reply.sent) return;

  if (!request.authContext?.passkey_verified) {
    reply.code(403).send({
      error: 'Passkey authentication required for this operation',
      code: 'PASSKEY_REQUIRED',
    });
    return;
  }
}

/** Require TOTP step-up verification for the current session */
export async function requireTotp(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  await requireAuth(request, reply);
  if (reply.sent) return;

  if (!request.authContext?.totp_verified) {
    reply.code(403).send({
      error: 'TOTP verification required for this operation',
      code: 'TOTP_REQUIRED',
    });
    return;
  }
}

/** Require a valid, approved approval token for write operations */
export async function requireApproval(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  await requireAuth(request, reply);
  if (reply.sent) return;

  const body = request.body as Record<string, unknown> | undefined;
  const approvalTokenId = body?.['approval_token_id'] as string | undefined;

  if (!approvalTokenId) {
    reply.code(403).send({
      error: 'Approval token required for this operation',
      code: 'APPROVAL_REQUIRED',
    });
    return;
  }

  const authContext = request.authContext!;
  const result = await validateApprovalToken(approvalTokenId, authContext.device_id);

  if (!result.valid) {
    logger.warn('Approval token validation failed', {
      token_id: approvalTokenId,
      reason: result.reason,
      session_id: authContext.session_id,
    });
    reply.code(403).send({
      error: `Approval token invalid: ${result.reason}`,
      code: 'INVALID_APPROVAL',
    });
    return;
  }
}

/** Require the requesting device to be enrolled and not revoked */
export async function requireEnrolledDevice(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  await requireAuth(request, reply);
  if (reply.sent) return;

  const authContext = request.authContext!;
  const enrolled = await isDeviceEnrolled(authContext.device_id);

  if (!enrolled) {
    reply.code(403).send({
      error: 'Device is not enrolled or has been revoked',
      code: 'DEVICE_NOT_ENROLLED',
    });
    return;
  }
}
