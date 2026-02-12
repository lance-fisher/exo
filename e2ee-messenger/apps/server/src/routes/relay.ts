import { Router, Request, Response } from 'express';
import { getDatabase } from '../database';

const router = Router();

/** Maximum message payload size: 64KB */
const MAX_PAYLOAD_SIZE = 65536;

/** Default TTL: 7 days */
const DEFAULT_TTL = 604800;

/** Maximum messages per recipient in store */
const MAX_STORED_MESSAGES = 1000;

/**
 * POST /relay/send
 * Store an encrypted blob for a recipient.
 *
 * Body: {
 *   recipientFingerprint: string,
 *   recipientDeviceId: string,
 *   senderFingerprint: string,
 *   encryptedPayload: string (base64 encoded encrypted message),
 *   ttl?: number (seconds, default 7 days)
 * }
 *
 * Note: The server cannot read the message contents. It only stores
 * encrypted blobs keyed by recipient identifiers.
 */
router.post('/send', (req: Request, res: Response) => {
  try {
    const {
      recipientFingerprint,
      recipientDeviceId,
      senderFingerprint,
      encryptedPayload,
      ttl,
    } = req.body;

    if (!recipientFingerprint || !recipientDeviceId || !senderFingerprint || !encryptedPayload) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Payload size check
    if (encryptedPayload.length > MAX_PAYLOAD_SIZE) {
      return res.status(413).json({ error: 'Payload too large' });
    }

    const db = getDatabase();

    // Check message count for recipient (abuse protection)
    const count = db.prepare(`
      SELECT COUNT(*) as cnt FROM relay_messages
      WHERE recipient_fingerprint = ? AND recipient_device_id = ? AND fetched = 0
    `).get(recipientFingerprint, recipientDeviceId) as { cnt: number };

    if (count.cnt >= MAX_STORED_MESSAGES) {
      return res.status(429).json({ error: 'Recipient mailbox full' });
    }

    db.prepare(`
      INSERT INTO relay_messages (recipient_fingerprint, recipient_device_id, sender_fingerprint, encrypted_payload, ttl)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      recipientFingerprint,
      recipientDeviceId,
      senderFingerprint,
      encryptedPayload,
      ttl || DEFAULT_TTL
    );

    res.json({ success: true });
  } catch (err: any) {
    console.error('Relay send error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /relay/fetch/:fingerprint/:deviceId
 * Fetch all pending encrypted messages for a recipient.
 *
 * Returns messages and marks them as fetched.
 */
router.get('/fetch/:fingerprint/:deviceId', (req: Request, res: Response) => {
  try {
    const { fingerprint, deviceId } = req.params;
    const db = getDatabase();

    const messages = db.prepare(`
      SELECT id, sender_fingerprint, encrypted_payload, created_at
      FROM relay_messages
      WHERE recipient_fingerprint = ? AND recipient_device_id = ? AND fetched = 0
      ORDER BY created_at ASC
      LIMIT 100
    `).all(fingerprint, deviceId) as any[];

    if (messages.length > 0) {
      const ids = messages.map(m => m.id);
      db.prepare(`
        UPDATE relay_messages SET fetched = 1 WHERE id IN (${ids.map(() => '?').join(',')})
      `).run(...ids);
    }

    res.json({
      messages: messages.map(m => ({
        id: m.id,
        senderFingerprint: m.sender_fingerprint,
        encryptedPayload: m.encrypted_payload,
        timestamp: m.created_at,
      })),
    });
  } catch (err: any) {
    console.error('Relay fetch error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /relay/ack
 * Acknowledge receipt of messages (permanent delete).
 *
 * Body: { messageIds: number[] }
 */
router.delete('/ack', (req: Request, res: Response) => {
  try {
    const { messageIds } = req.body;

    if (!messageIds || !Array.isArray(messageIds)) {
      return res.status(400).json({ error: 'Missing messageIds' });
    }

    const db = getDatabase();
    db.prepare(`
      DELETE FROM relay_messages WHERE id IN (${messageIds.map(() => '?').join(',')}) AND fetched = 1
    `).run(...messageIds);

    res.json({ success: true });
  } catch (err: any) {
    console.error('Relay ack error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
