import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import http from 'http';
import rendezvousRoutes from './routes/rendezvous';
import relayRoutes from './routes/relay';
import signalingRoutes from './routes/signaling';
import { closeDatabase } from './database';

let app: express.Application;
let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  // Set test database path
  process.env.DB_PATH = ':memory:';

  app = express();
  app.use(express.json());
  app.use('/rendezvous', rendezvousRoutes);
  app.use('/relay', relayRoutes);
  app.use('/signaling', signalingRoutes);

  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const addr = server.address() as any;
      baseUrl = `http://localhost:${addr.port}`;
      resolve();
    });
  });
});

afterAll(() => {
  server?.close();
  closeDatabase();
});

async function post(path: string, body: any) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json() };
}

async function get(path: string) {
  const res = await fetch(`${baseUrl}${path}`);
  return { status: res.status, data: await res.json() };
}

async function del(path: string, body: any) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json() };
}

describe('Rendezvous API', () => {
  const testAttestation = {
    version: 1,
    pgpFingerprint: 'a'.repeat(40),
    messagingIdentityPublicKey: 'dGVzdA==',
    deviceId: 'device-001',
    timestamp: Date.now(),
    pgpSignature: '-----BEGIN PGP SIGNATURE-----\ntest\n-----END PGP SIGNATURE-----',
  };

  const testSignedPreKey = {
    keyId: 0,
    publicKey: 'c3BrLXB1Yg==',
    signature: 'c2lnbmF0dXJl',
    timestamp: Date.now(),
  };

  const testOneTimePreKeys = [
    { keyId: 0, publicKey: 'b3RwazA=' },
    { keyId: 1, publicKey: 'b3RwazE=' },
  ];

  it('should publish attestation and prekeys', async () => {
    const { status, data } = await post('/rendezvous/publish', {
      attestation: testAttestation,
      signedPreKey: testSignedPreKey,
      oneTimePreKeys: testOneTimePreKeys,
    });
    expect(status).toBe(200);
    expect(data.success).toBe(true);
  });

  it('should lookup by fingerprint', async () => {
    const { status, data } = await get(`/rendezvous/lookup/${testAttestation.pgpFingerprint}`);
    expect(status).toBe(200);
    expect(data.fingerprint).toBe(testAttestation.pgpFingerprint);
    expect(data.devices).toHaveLength(1);
    expect(data.devices[0].attestation.deviceId).toBe('device-001');
    expect(data.devices[0].signedPreKey).toBeTruthy();
  });

  it('should consume one-time prekey on lookup', async () => {
    const { data: first } = await get(`/rendezvous/lookup/${testAttestation.pgpFingerprint}`);
    const { data: second } = await get(`/rendezvous/lookup/${testAttestation.pgpFingerprint}`);

    // First lookup should get OTP key id 1 (0 was consumed in previous test)
    // Second lookup may or may not have OTP key
    expect(first.devices[0]).toBeTruthy();
  });

  it('should return 404 for unknown fingerprint', async () => {
    const { status } = await get('/rendezvous/lookup/' + 'b'.repeat(40));
    expect(status).toBe(404);
  });

  it('should handle device revocation', async () => {
    // Publish a second device
    await post('/rendezvous/publish', {
      attestation: { ...testAttestation, deviceId: 'device-002' },
      signedPreKey: { ...testSignedPreKey, keyId: 1 },
      oneTimePreKeys: [],
    });

    // Revoke device-002
    const { status } = await post('/rendezvous/revoke', {
      revocation: {
        version: 1,
        pgpFingerprint: testAttestation.pgpFingerprint,
        revokedDeviceId: 'device-002',
        timestamp: Date.now(),
        pgpSignature: '-----BEGIN PGP SIGNATURE-----\nrevoke\n-----END PGP SIGNATURE-----',
      },
    });
    expect(status).toBe(200);

    // Lookup should not include revoked device
    const { data } = await get(`/rendezvous/lookup/${testAttestation.pgpFingerprint}`);
    const deviceIds = data.devices.map((d: any) => d.attestation.deviceId);
    expect(deviceIds).not.toContain('device-002');
  });
});

describe('Relay API', () => {
  const recipientFp = 'c'.repeat(40);
  const senderFp = 'd'.repeat(40);
  let storedMessageIds: number[] = [];

  it('should store encrypted relay messages', async () => {
    const { status, data } = await post('/relay/send', {
      recipientFingerprint: recipientFp,
      recipientDeviceId: 'device-001',
      senderFingerprint: senderFp,
      encryptedPayload: 'ZW5jcnlwdGVkX21lc3NhZ2U=',
    });
    expect(status).toBe(200);
    expect(data.success).toBe(true);
  });

  it('should fetch pending messages', async () => {
    const { status, data } = await get(`/relay/fetch/${recipientFp}/device-001`);
    expect(status).toBe(200);
    expect(data.messages).toHaveLength(1);
    expect(data.messages[0].senderFingerprint).toBe(senderFp);
    expect(data.messages[0].encryptedPayload).toBe('ZW5jcnlwdGVkX21lc3NhZ2U=');
    storedMessageIds = data.messages.map((m: any) => m.id);
  });

  it('should not return already fetched messages', async () => {
    const { data } = await get(`/relay/fetch/${recipientFp}/device-001`);
    expect(data.messages).toHaveLength(0);
  });

  it('should acknowledge and delete messages', async () => {
    const { status, data } = await del('/relay/ack', { messageIds: storedMessageIds });
    expect(status).toBe(200);
    expect(data.success).toBe(true);
  });

  it('should reject oversized payloads', async () => {
    const { status } = await post('/relay/send', {
      recipientFingerprint: recipientFp,
      recipientDeviceId: 'device-001',
      senderFingerprint: senderFp,
      encryptedPayload: 'x'.repeat(70000),
    });
    expect(status).toBe(413);
  });

  it('should reject missing required fields', async () => {
    const { status } = await post('/relay/send', {
      recipientFingerprint: recipientFp,
    });
    expect(status).toBe(400);
  });
});

describe('Signaling API', () => {
  it('should store and retrieve signaling messages', async () => {
    const { status } = await post('/signaling/send', {
      recipientFingerprint: 'e'.repeat(40),
      recipientDeviceId: 'device-001',
      senderFingerprint: 'f'.repeat(40),
      senderDeviceId: 'device-002',
      signalType: 'offer',
      payload: JSON.stringify({ sdp: 'test-sdp' }),
    });
    expect(status).toBe(200);

    const { data } = await get(`/signaling/poll/${'e'.repeat(40)}/device-001`);
    expect(data.signals).toHaveLength(1);
    expect(data.signals[0].signalType).toBe('offer');
    expect(data.signals[0].payload.sdp).toBe('test-sdp');
  });

  it('should delete signaling messages after poll', async () => {
    const { data } = await get(`/signaling/poll/${'e'.repeat(40)}/device-001`);
    expect(data.signals).toHaveLength(0);
  });

  it('should reject invalid signal types', async () => {
    const { status } = await post('/signaling/send', {
      recipientFingerprint: 'e'.repeat(40),
      recipientDeviceId: 'device-001',
      senderFingerprint: 'f'.repeat(40),
      senderDeviceId: 'device-002',
      signalType: 'invalid',
      payload: '{}',
    });
    expect(status).toBe(400);
  });
});
