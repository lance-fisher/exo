import { Router, Request, Response } from 'express';
import { getDatabase } from '../database';

const router = Router();

/**
 * POST /signaling/send
 * Send a WebRTC signaling message (offer/answer/ICE candidate).
 *
 * Body: {
 *   recipientFingerprint: string,
 *   recipientDeviceId: string,
 *   senderFingerprint: string,
 *   senderDeviceId: string,
 *   signalType: 'offer' | 'answer' | 'ice-candidate',
 *   payload: string (JSON-encoded signaling data)
 * }
 *
 * Note: Signaling messages are transient and auto-deleted after 5 minutes.
 * They contain only connection metadata (SDP, ICE candidates), not message content.
 */
router.post('/send', (req: Request, res: Response) => {
  try {
    const {
      recipientFingerprint,
      recipientDeviceId,
      senderFingerprint,
      senderDeviceId,
      signalType,
      payload,
    } = req.body;

    if (!recipientFingerprint || !recipientDeviceId || !senderFingerprint || !senderDeviceId || !signalType || !payload) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const validTypes = ['offer', 'answer', 'ice-candidate'];
    if (!validTypes.includes(signalType)) {
      return res.status(400).json({ error: 'Invalid signal type' });
    }

    const db = getDatabase();

    db.prepare(`
      INSERT INTO signaling (recipient_fingerprint, recipient_device_id, sender_fingerprint, sender_device_id, signal_type, payload)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      recipientFingerprint,
      recipientDeviceId,
      senderFingerprint,
      senderDeviceId,
      signalType,
      payload
    );

    res.json({ success: true });
  } catch (err: any) {
    console.error('Signaling send error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /signaling/poll/:fingerprint/:deviceId
 * Poll for pending signaling messages.
 * Messages are deleted after retrieval.
 */
router.get('/poll/:fingerprint/:deviceId', (req: Request, res: Response) => {
  try {
    const { fingerprint, deviceId } = req.params;
    const db = getDatabase();

    const messages = db.prepare(`
      SELECT id, sender_fingerprint, sender_device_id, signal_type, payload, created_at
      FROM signaling
      WHERE recipient_fingerprint = ? AND recipient_device_id = ?
      ORDER BY created_at ASC
    `).all(fingerprint, deviceId) as any[];

    if (messages.length > 0) {
      const ids = messages.map(m => m.id);
      db.prepare(`
        DELETE FROM signaling WHERE id IN (${ids.map(() => '?').join(',')})
      `).run(...ids);
    }

    res.json({
      signals: messages.map(m => ({
        senderFingerprint: m.sender_fingerprint,
        senderDeviceId: m.sender_device_id,
        signalType: m.signal_type,
        payload: JSON.parse(m.payload),
        timestamp: m.created_at,
      })),
    });
  } catch (err: any) {
    console.error('Signaling poll error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
