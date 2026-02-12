/**
 * API client for rendezvous and relay server.
 */

const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3001';

async function request(path: string, options?: RequestInit): Promise<any> {
  const res = await fetch(`${SERVER_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }

  return res.json();
}

// ---- Rendezvous API ----

export async function publishIdentity(data: {
  attestation: any;
  signedPreKey: any;
  oneTimePreKeys: any[];
}): Promise<void> {
  await request('/rendezvous/publish', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function lookupIdentity(fingerprint: string): Promise<any> {
  return request(`/rendezvous/lookup/${fingerprint}`);
}

export async function publishRevocation(revocation: any): Promise<void> {
  await request('/rendezvous/revoke', {
    method: 'POST',
    body: JSON.stringify({ revocation }),
  });
}

// ---- Relay API ----

export async function sendRelayMessage(data: {
  recipientFingerprint: string;
  recipientDeviceId: string;
  senderFingerprint: string;
  encryptedPayload: string;
}): Promise<void> {
  await request('/relay/send', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function fetchRelayMessages(
  fingerprint: string,
  deviceId: string
): Promise<any[]> {
  const result = await request(`/relay/fetch/${fingerprint}/${deviceId}`);
  return result.messages;
}

export async function ackRelayMessages(messageIds: number[]): Promise<void> {
  await request('/relay/ack', {
    method: 'DELETE',
    body: JSON.stringify({ messageIds }),
  });
}

// ---- Signaling API ----

export async function sendSignaling(data: {
  recipientFingerprint: string;
  recipientDeviceId: string;
  senderFingerprint: string;
  senderDeviceId: string;
  signalType: string;
  payload: string;
}): Promise<void> {
  await request('/signaling/send', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function pollSignaling(
  fingerprint: string,
  deviceId: string
): Promise<any[]> {
  const result = await request(`/signaling/poll/${fingerprint}/${deviceId}`);
  return result.signals;
}

// ---- WebSocket ----

export function createWebSocket(
  fingerprint: string,
  deviceId: string,
  onMessage: (msg: any) => void
): WebSocket {
  const wsUrl = SERVER_URL.replace(/^http/, 'ws') + '/ws';
  const ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    ws.send(JSON.stringify({
      type: 'register',
      fingerprint,
      deviceId,
    }));
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      onMessage(msg);
    } catch {
      // Ignore malformed messages
    }
  };

  return ws;
}
