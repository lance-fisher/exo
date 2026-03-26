// ─────────────────────────────────────────────────────────────────────────────
// Sovereign Console UI — Authentication Helpers
// ─────────────────────────────────────────────────────────────────────────────

import {
  startAuthentication,
  startRegistration,
} from '@simplewebauthn/browser';

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`);
  }

  return res.json() as Promise<T>;
}

/** Start passkey authentication flow */
export async function startPasskeyAuth(): Promise<{ session_id: string }> {
  // 1. Get authentication options from broker
  const { options } = await post<{ options: Parameters<typeof startAuthentication>[0] }>(
    '/api/auth/passkey/options',
  );

  // 2. Create credential via browser WebAuthn API
  const credential = await startAuthentication(options);

  // 3. Send credential to broker for verification
  const result = await post<{ session_id: string }>(
    '/api/auth/passkey/verify',
    { credential },
  );

  return result;
}

/** Start passkey enrollment on a new device */
export async function startPasskeyEnrollment(enrollmentCode: string): Promise<{ device_id: string }> {
  // 1. Verify enrollment code
  const { options } = await post<{ options: Parameters<typeof startRegistration>[0] }>(
    '/api/enrollment/passkey/options',
    { code: enrollmentCode },
  );

  // 2. Create credential via browser WebAuthn API
  const credential = await startRegistration(options);

  // 3. Complete enrollment
  const result = await post<{ device_id: string }>(
    '/api/enrollment/complete',
    { code: enrollmentCode, credential },
  );

  return result;
}

/** Verify TOTP code for step-up authentication */
export async function verifyTotp(code: string): Promise<{ verified: boolean }> {
  return post<{ verified: boolean }>('/api/auth/totp/verify', { code });
}

/** End the current session */
export async function logout(): Promise<void> {
  await fetch(`${BASE_URL}/api/auth/logout`, {
    method: 'POST',
    credentials: 'include',
  });
}
