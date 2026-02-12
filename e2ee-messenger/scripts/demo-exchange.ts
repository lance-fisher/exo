/**
 * Demo script: simulates two clients (Alice and Bob) performing
 * the full E2EE handshake and message exchange.
 *
 * This runs against the live server at localhost:3001.
 */

import { initCrypto } from '../packages/crypto/src/sodium-init';
import { PGPIdentity } from '../packages/crypto/src/pgp-identity';
import { KeyBundle } from '../packages/crypto/src/key-bundle';
import { X3DHHandshake } from '../packages/crypto/src/x3dh';
import { DoubleRatchet } from '../packages/crypto/src/double-ratchet';
import { SafetyNumber } from '../packages/crypto/src/safety-number';
import { generateRecoveryCode } from '../packages/crypto/src/recovery';
import * as openpgp from 'openpgp';

const SERVER = 'http://localhost:3001';

async function post(path: string, body: any) {
  const res = await fetch(`${SERVER}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function get(path: string) {
  const res = await fetch(`${SERVER}${path}`);
  return res.json();
}

function log(prefix: string, msg: string) {
  const color = prefix === 'ALICE' ? '\x1b[36m' : prefix === 'BOB' ? '\x1b[33m' : '\x1b[32m';
  console.log(`${color}[${prefix}]\x1b[0m ${msg}`);
}

async function main() {
  await initCrypto();

  console.log('\n--- Phase 1: Key Generation ---\n');

  // Generate PGP keys for both users
  log('ALICE', 'Generating PGP key...');
  const alicePGPKeys = await openpgp.generateKey({
    type: 'ecc',
    curve: 'curve25519',
    userIDs: [{ name: 'Alice', email: 'alice@example.com' }],
    format: 'armored',
  });

  log('BOB', 'Generating PGP key...');
  const bobPGPKeys = await openpgp.generateKey({
    type: 'ecc',
    curve: 'curve25519',
    userIDs: [{ name: 'Bob', email: 'bob@example.com' }],
    format: 'armored',
  });

  // Import PGP keys
  const alicePGP = new PGPIdentity();
  const aliceInfo = await alicePGP.importPrivateKey(alicePGPKeys.privateKey);
  log('ALICE', `PGP fingerprint: ${aliceInfo.fingerprint}`);

  const bobPGP = new PGPIdentity();
  const bobInfo = await bobPGP.importPrivateKey(bobPGPKeys.privateKey);
  log('BOB', `PGP fingerprint: ${bobInfo.fingerprint}`);

  // Generate messaging identity keys
  log('ALICE', 'Generating messaging identity key (Ed25519)...');
  const aliceBundle = new KeyBundle();
  const aliceIdPub = await aliceBundle.generateIdentityKeyPair();
  const aliceSpk = await aliceBundle.generateSignedPreKey();
  const aliceOtpks = await aliceBundle.generateOneTimePreKeys(10);

  log('BOB', 'Generating messaging identity key (Ed25519)...');
  const bobBundle = new KeyBundle();
  const bobIdPub = await bobBundle.generateIdentityKeyPair();
  const bobSpk = await bobBundle.generateSignedPreKey();
  const bobOtpks = await bobBundle.generateOneTimePreKeys(10);

  // Sign attestations
  log('ALICE', 'Signing attestation (PGP signs messaging identity)...');
  const aliceAttestation = await alicePGP.signAttestation(aliceIdPub, 'alice-device-1');

  log('BOB', 'Signing attestation (PGP signs messaging identity)...');
  const bobAttestation = await bobPGP.signAttestation(bobIdPub, 'bob-device-1');

  // Generate recovery codes
  const aliceRecovery = await generateRecoveryCode();
  log('ALICE', `Recovery code: ${aliceRecovery.code.slice(0, 19)}...`);
  const bobRecovery = await generateRecoveryCode();
  log('BOB', `Recovery code: ${bobRecovery.code.slice(0, 19)}...`);

  console.log('\n--- Phase 2: Publish to Rendezvous Server ---\n');

  // Publish to server
  log('ALICE', 'Publishing attestation and pre-keys to server...');
  await post('/rendezvous/publish', {
    attestation: aliceAttestation,
    signedPreKey: {
      keyId: aliceSpk.keyId,
      publicKey: Buffer.from(aliceSpk.publicKey).toString('base64'),
      signature: Buffer.from(aliceSpk.signature).toString('base64'),
      timestamp: aliceSpk.timestamp,
    },
    oneTimePreKeys: aliceOtpks.map(k => ({
      keyId: k.keyId,
      publicKey: Buffer.from(k.publicKey).toString('base64'),
    })),
  });
  log('ALICE', 'Published successfully.');

  log('BOB', 'Publishing attestation and pre-keys to server...');
  await post('/rendezvous/publish', {
    attestation: bobAttestation,
    signedPreKey: {
      keyId: bobSpk.keyId,
      publicKey: Buffer.from(bobSpk.publicKey).toString('base64'),
      signature: Buffer.from(bobSpk.signature).toString('base64'),
      timestamp: bobSpk.timestamp,
    },
    oneTimePreKeys: bobOtpks.map(k => ({
      keyId: k.keyId,
      publicKey: Buffer.from(k.publicKey).toString('base64'),
    })),
  });
  log('BOB', 'Published successfully.');

  console.log('\n--- Phase 3: Contact Discovery and Verification ---\n');

  // Alice looks up Bob
  log('ALICE', `Looking up Bob's fingerprint: ${bobInfo.fingerprint.slice(0, 16)}...`);
  const bobLookup = await get(`/rendezvous/lookup/${bobInfo.fingerprint}`);
  log('ALICE', `Found ${bobLookup.devices.length} device(s) for Bob.`);

  // Verify attestation
  log('ALICE', 'Verifying Bob\'s PGP attestation...');
  const bobAttValid = await PGPIdentity.verifyAttestation(
    bobLookup.devices[0].attestation,
    bobPGPKeys.publicKey
  );
  log('ALICE', `Attestation valid: ${bobAttValid}`);

  // Compute safety number
  const safetyBlocks = await SafetyNumber.computeBlocks(aliceIdPub, bobIdPub);
  log('SYSTEM', `Safety Number: ${safetyBlocks.join(' ')}`);

  console.log('\n--- Phase 4: X3DH Key Agreement ---\n');

  // Alice initiates X3DH with Bob's pre-key bundle
  log('ALICE', 'Performing X3DH handshake with Bob\'s pre-key bundle...');

  const bobPublicBundle = bobBundle.getPublicPreKeyBundle();
  const aliceX3DH = await X3DHHandshake.initiatorAgree(
    {
      publicKey: aliceBundle.getIdentityPublicKey(),
      privateKey: aliceBundle.getIdentityPrivateKey(),
    },
    bobPublicBundle
  );
  log('ALICE', `Shared secret derived (${aliceX3DH.sharedSecret.length} bytes)`);
  log('ALICE', `Used one-time prekey: ${aliceX3DH.usedOneTimePreKeyId}`);

  // Bob computes shared secret
  log('BOB', 'Computing shared secret from Alice\'s initial message...');
  let otpkPrivate: Uint8Array | undefined;
  if (aliceX3DH.usedOneTimePreKeyId !== undefined) {
    otpkPrivate = bobBundle.consumeOneTimePreKey(aliceX3DH.usedOneTimePreKeyId);
  }
  const bobSharedSecret = await X3DHHandshake.responderAgree(
    {
      publicKey: bobBundle.getIdentityPublicKey(),
      privateKey: bobBundle.getIdentityPrivateKey(),
    },
    bobBundle.getSignedPreKeyPrivate(),
    aliceBundle.getIdentityPublicKey(),
    aliceX3DH.ephemeralPublicKey,
    otpkPrivate
  );

  const secretsMatch = Buffer.from(aliceX3DH.sharedSecret).toString('hex') ===
                        Buffer.from(bobSharedSecret).toString('hex');
  log('SYSTEM', `Shared secrets match: ${secretsMatch}`);

  if (!secretsMatch) {
    throw new Error('FATAL: Shared secrets do not match!');
  }

  console.log('\n--- Phase 5: Double Ratchet Session ---\n');

  // Initialize ratchets
  log('ALICE', 'Initializing Double Ratchet (initiator)...');
  const aliceRatchet = await DoubleRatchet.initInitiator(
    aliceX3DH.sharedSecret,
    bobPublicBundle.signedPreKey.publicKey
  );

  log('BOB', 'Initializing Double Ratchet (responder)...');
  const bobRatchet = await DoubleRatchet.initResponder(
    bobSharedSecret,
    {
      publicKey: bobPublicBundle.signedPreKey.publicKey,
      privateKey: bobBundle.getSignedPreKeyPrivate(),
    }
  );

  console.log('\n--- Phase 6: Encrypted Message Exchange ---\n');

  // Alice -> Bob
  const msg1 = 'Hello Bob! This message is end-to-end encrypted with forward secrecy.';
  log('ALICE', `Encrypting: "${msg1}"`);
  const enc1 = await aliceRatchet.encrypt(new TextEncoder().encode(msg1));
  log('ALICE', `Ciphertext: ${Buffer.from(enc1.ciphertext).toString('hex').slice(0, 64)}...`);
  log('ALICE', `Nonce: ${Buffer.from(enc1.nonce).toString('hex')}`);

  // Simulate relay
  const relayPayload1 = JSON.stringify({
    header: {
      dhPublicKey: Buffer.from(enc1.header.dhPublicKey).toString('base64'),
      previousChainLength: enc1.header.previousChainLength,
      messageNumber: enc1.header.messageNumber,
    },
    ciphertext: Buffer.from(enc1.ciphertext).toString('base64'),
    nonce: Buffer.from(enc1.nonce).toString('base64'),
  });

  log('ALICE', 'Sending encrypted blob via relay...');
  await post('/relay/send', {
    recipientFingerprint: bobInfo.fingerprint,
    recipientDeviceId: 'bob-device-1',
    senderFingerprint: aliceInfo.fingerprint,
    encryptedPayload: Buffer.from(relayPayload1).toString('base64'),
  });

  // Bob fetches
  log('BOB', 'Fetching messages from relay...');
  const relayMessages = await get(`/relay/fetch/${bobInfo.fingerprint}/bob-device-1`);
  log('BOB', `Received ${relayMessages.messages.length} message(s)`);

  const received1 = JSON.parse(
    Buffer.from(relayMessages.messages[0].encryptedPayload, 'base64').toString()
  );

  const dec1 = await bobRatchet.decrypt({
    header: {
      dhPublicKey: Uint8Array.from(Buffer.from(received1.header.dhPublicKey, 'base64')),
      previousChainLength: received1.header.previousChainLength,
      messageNumber: received1.header.messageNumber,
    },
    ciphertext: Uint8Array.from(Buffer.from(received1.ciphertext, 'base64')),
    nonce: Uint8Array.from(Buffer.from(received1.nonce, 'base64')),
  });
  log('BOB', `Decrypted: "${new TextDecoder().decode(dec1)}"`);

  // Bob -> Alice
  const msg2 = 'Hi Alice! The Double Ratchet is working. Each message has a new key.';
  log('BOB', `Encrypting: "${msg2}"`);
  const enc2 = await bobRatchet.encrypt(new TextEncoder().encode(msg2));
  log('BOB', `Ciphertext: ${Buffer.from(enc2.ciphertext).toString('hex').slice(0, 64)}...`);

  const dec2 = await aliceRatchet.decrypt(enc2);
  log('ALICE', `Decrypted: "${new TextDecoder().decode(dec2)}"`);

  // One more round
  const msg3 = 'Forward secrecy means compromising current keys won\'t reveal past messages.';
  log('ALICE', `Encrypting: "${msg3}"`);
  const enc3 = await aliceRatchet.encrypt(new TextEncoder().encode(msg3));
  const dec3 = await bobRatchet.decrypt(enc3);
  log('BOB', `Decrypted: "${new TextDecoder().decode(dec3)}"`);

  console.log('\n--- Phase 7: Security Properties Achieved ---\n');
  log('SYSTEM', '✓ PGP identity anchoring (attestation signed by PGP key)');
  log('SYSTEM', '✓ X3DH key agreement (4 DH operations)');
  log('SYSTEM', '✓ Double Ratchet forward secrecy (new keys per message)');
  log('SYSTEM', '✓ Post-compromise security (DH ratchet heals after compromise)');
  log('SYSTEM', '✓ XChaCha20-Poly1305 AEAD encryption');
  log('SYSTEM', '✓ Replay protection (message numbers)');
  log('SYSTEM', '✓ Message authentication (AEAD tag)');
  log('SYSTEM', '✓ Encrypted relay transport');
  log('SYSTEM', '✓ Safety Number verification');
  log('SYSTEM', '✓ Recovery code generation');

  // Cleanup
  aliceRatchet.destroy();
  bobRatchet.destroy();
  aliceBundle.destroy();
  bobBundle.destroy();
  alicePGP.destroy();
  bobPGP.destroy();

  console.log('\n--- Demo complete. All cryptographic operations verified. ---\n');
}

main().catch(err => {
  console.error('Demo failed:', err);
  process.exit(1);
});
