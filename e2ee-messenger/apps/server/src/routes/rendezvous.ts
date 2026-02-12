import { Router, Request, Response } from 'express';
import { getDatabase } from '../database';

const router = Router();

/**
 * POST /rendezvous/publish
 * Publish identity attestation and pre-keys.
 *
 * Body: {
 *   attestation: AttestationStatement,
 *   signedPreKey: { keyId, publicKey (base64), signature (base64), timestamp },
 *   oneTimePreKeys: Array<{ keyId, publicKey (base64) }>
 * }
 */
router.post('/publish', (req: Request, res: Response) => {
  try {
    const { attestation, signedPreKey, oneTimePreKeys } = req.body;

    if (!attestation || !signedPreKey) {
      return res.status(400).json({ error: 'Missing attestation or signed pre-key' });
    }

    const db = getDatabase();

    // Upsert attestation
    db.prepare(`
      INSERT INTO attestations (pgp_fingerprint, device_id, messaging_identity_public_key, pgp_signature, timestamp, version)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(pgp_fingerprint, device_id)
      DO UPDATE SET
        messaging_identity_public_key = excluded.messaging_identity_public_key,
        pgp_signature = excluded.pgp_signature,
        timestamp = excluded.timestamp,
        version = excluded.version
    `).run(
      attestation.pgpFingerprint,
      attestation.deviceId,
      attestation.messagingIdentityPublicKey,
      attestation.pgpSignature,
      attestation.timestamp,
      attestation.version
    );

    // Upsert signed pre-key
    db.prepare(`
      INSERT INTO signed_prekeys (pgp_fingerprint, device_id, key_id, public_key, signature, timestamp)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(pgp_fingerprint, device_id, key_id)
      DO UPDATE SET
        public_key = excluded.public_key,
        signature = excluded.signature,
        timestamp = excluded.timestamp
    `).run(
      attestation.pgpFingerprint,
      attestation.deviceId,
      signedPreKey.keyId,
      signedPreKey.publicKey,
      signedPreKey.signature,
      signedPreKey.timestamp
    );

    // Insert one-time pre-keys
    if (oneTimePreKeys && Array.isArray(oneTimePreKeys)) {
      const insert = db.prepare(`
        INSERT OR IGNORE INTO onetime_prekeys (pgp_fingerprint, device_id, key_id, public_key)
        VALUES (?, ?, ?, ?)
      `);

      const insertMany = db.transaction((keys: any[]) => {
        for (const key of keys) {
          insert.run(attestation.pgpFingerprint, attestation.deviceId, key.keyId, key.publicKey);
        }
      });
      insertMany(oneTimePreKeys);
    }

    res.json({ success: true });
  } catch (err: any) {
    console.error('Publish error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /rendezvous/lookup/:fingerprint
 * Fetch attestation and pre-key bundle for a fingerprint.
 */
router.get('/lookup/:fingerprint', (req: Request, res: Response) => {
  try {
    const { fingerprint } = req.params;
    const db = getDatabase();

    // Check for revocations
    const revocations = db.prepare(`
      SELECT revoked_device_id FROM revocations WHERE pgp_fingerprint = ?
    `).all(fingerprint) as { revoked_device_id: string }[];

    const revokedDeviceIds = new Set(revocations.map(r => r.revoked_device_id));

    // Get all attestations for this fingerprint
    const attestations = db.prepare(`
      SELECT * FROM attestations WHERE pgp_fingerprint = ?
    `).all(fingerprint) as any[];

    // Filter out revoked devices
    const activeAttestations = attestations.filter(a => !revokedDeviceIds.has(a.device_id));

    if (activeAttestations.length === 0) {
      return res.status(404).json({ error: 'No attestations found' });
    }

    // For each active device, get the pre-key bundle
    const devices = activeAttestations.map(att => {
      const signedPreKey = db.prepare(`
        SELECT * FROM signed_prekeys
        WHERE pgp_fingerprint = ? AND device_id = ?
        ORDER BY key_id DESC LIMIT 1
      `).get(fingerprint, att.device_id) as any;

      // Consume one one-time prekey (delete after fetch)
      const oneTimePreKey = db.prepare(`
        SELECT * FROM onetime_prekeys
        WHERE pgp_fingerprint = ? AND device_id = ?
        ORDER BY id ASC LIMIT 1
      `).get(fingerprint, att.device_id) as any;

      if (oneTimePreKey) {
        db.prepare('DELETE FROM onetime_prekeys WHERE id = ?').run(oneTimePreKey.id);
      }

      return {
        attestation: {
          version: att.version,
          pgpFingerprint: att.pgp_fingerprint,
          messagingIdentityPublicKey: att.messaging_identity_public_key,
          deviceId: att.device_id,
          timestamp: att.timestamp,
          pgpSignature: att.pgp_signature,
        },
        signedPreKey: signedPreKey ? {
          keyId: signedPreKey.key_id,
          publicKey: signedPreKey.public_key,
          signature: signedPreKey.signature,
          timestamp: signedPreKey.timestamp,
        } : null,
        oneTimePreKey: oneTimePreKey ? {
          keyId: oneTimePreKey.key_id,
          publicKey: oneTimePreKey.public_key,
        } : null,
      };
    });

    res.json({ fingerprint, devices });
  } catch (err: any) {
    console.error('Lookup error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /rendezvous/revoke
 * Publish a device revocation.
 *
 * Body: { revocation: DeviceRevocation }
 */
router.post('/revoke', (req: Request, res: Response) => {
  try {
    const { revocation } = req.body;

    if (!revocation) {
      return res.status(400).json({ error: 'Missing revocation' });
    }

    const db = getDatabase();

    db.prepare(`
      INSERT INTO revocations (pgp_fingerprint, revoked_device_id, timestamp, pgp_signature)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(pgp_fingerprint, revoked_device_id)
      DO UPDATE SET timestamp = excluded.timestamp, pgp_signature = excluded.pgp_signature
    `).run(
      revocation.pgpFingerprint,
      revocation.revokedDeviceId,
      revocation.timestamp,
      revocation.pgpSignature
    );

    // Clean up attestation and prekeys for revoked device
    db.prepare('DELETE FROM attestations WHERE pgp_fingerprint = ? AND device_id = ?')
      .run(revocation.pgpFingerprint, revocation.revokedDeviceId);
    db.prepare('DELETE FROM signed_prekeys WHERE pgp_fingerprint = ? AND device_id = ?')
      .run(revocation.pgpFingerprint, revocation.revokedDeviceId);
    db.prepare('DELETE FROM onetime_prekeys WHERE pgp_fingerprint = ? AND device_id = ?')
      .run(revocation.pgpFingerprint, revocation.revokedDeviceId);

    res.json({ success: true });
  } catch (err: any) {
    console.error('Revoke error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
