import { describe, it, expect, beforeAll } from 'vitest';
import { initCrypto } from './sodium-init';
import { PGPIdentity } from './pgp-identity';
import { KeyBundle } from './key-bundle';
import { X3DHHandshake } from './x3dh';
import { DoubleRatchet } from './double-ratchet';
import { LocalVault } from './local-vault';
import { SafetyNumber } from './safety-number';
import { generateRecoveryCode, validateRecoveryCode } from './recovery';
import * as openpgp from 'openpgp';

// Test PGP key (generated for testing only)
let testPGPKey: { privateKey: string; publicKey: string };

beforeAll(async () => {
  await initCrypto();

  // Generate a test PGP key pair
  const { privateKey, publicKey } = await openpgp.generateKey({
    type: 'ecc',
    curve: 'curve25519',
    userIDs: [{ name: 'Test User', email: 'test@example.com' }],
    format: 'armored',
  });
  testPGPKey = { privateKey, publicKey };
});

describe('PGP Identity', () => {
  it('should import a PGP private key and extract identity info', async () => {
    const pgp = new PGPIdentity();
    const info = await pgp.importPrivateKey(testPGPKey.privateKey);

    expect(info.fingerprint).toBeTruthy();
    expect(info.fingerprint.length).toBe(40); // SHA-1 fingerprint
    expect(info.userIds).toContain('Test User <test@example.com>');
    expect(info.keyId).toBeTruthy();

    pgp.destroy();
  });

  it('should export armored public key', async () => {
    const pgp = new PGPIdentity();
    await pgp.importPrivateKey(testPGPKey.privateKey);
    const armoredPub = pgp.getArmoredPublicKey();

    expect(armoredPub).toContain('-----BEGIN PGP PUBLIC KEY BLOCK-----');
    pgp.destroy();
  });

  it('should sign and verify an attestation statement', async () => {
    const pgp = new PGPIdentity();
    await pgp.importPrivateKey(testPGPKey.privateKey);

    // Generate a messaging identity key
    const bundle = new KeyBundle();
    const identityPub = await bundle.generateIdentityKeyPair();

    const attestation = await pgp.signAttestation(identityPub, 'device-001');

    expect(attestation.version).toBe(1);
    expect(attestation.pgpFingerprint).toBeTruthy();
    expect(attestation.deviceId).toBe('device-001');
    expect(attestation.pgpSignature).toContain('-----BEGIN PGP SIGNATURE-----');

    // Verify the attestation
    const valid = await PGPIdentity.verifyAttestation(attestation, testPGPKey.publicKey);
    expect(valid).toBe(true);

    // Tamper with attestation should fail
    const tampered = { ...attestation, deviceId: 'tampered-device' };
    const invalid = await PGPIdentity.verifyAttestation(tampered, testPGPKey.publicKey);
    expect(invalid).toBe(false);

    pgp.destroy();
    bundle.destroy();
  });

  it('should sign device revocation', async () => {
    const pgp = new PGPIdentity();
    await pgp.importPrivateKey(testPGPKey.privateKey);

    const revocation = await pgp.signDeviceRevocation('device-to-revoke');
    expect(revocation.revokedDeviceId).toBe('device-to-revoke');
    expect(revocation.pgpSignature).toContain('-----BEGIN PGP SIGNATURE-----');

    pgp.destroy();
  });
});

describe('Key Bundle', () => {
  it('should generate identity key pair', async () => {
    const bundle = new KeyBundle();
    const pub = await bundle.generateIdentityKeyPair();

    expect(pub).toBeInstanceOf(Uint8Array);
    expect(pub.length).toBe(32); // Ed25519 public key

    bundle.destroy();
  });

  it('should generate signed pre-key with valid signature', async () => {
    const bundle = new KeyBundle();
    await bundle.generateIdentityKeyPair();
    const spk = await bundle.generateSignedPreKey();

    expect(spk.publicKey.length).toBe(32); // X25519 public key
    expect(spk.signature.length).toBe(64); // Ed25519 signature

    // Verify the signature
    const valid = await KeyBundle.verifySignedPreKey(
      bundle.getIdentityPublicKey(),
      spk
    );
    expect(valid).toBe(true);

    bundle.destroy();
  });

  it('should generate one-time pre-keys', async () => {
    const bundle = new KeyBundle();
    await bundle.generateIdentityKeyPair();

    const otpks = await bundle.generateOneTimePreKeys(10);
    expect(otpks.length).toBe(10);
    expect(otpks[0].publicKey.length).toBe(32);

    bundle.destroy();
  });

  it('should export and import from vault', async () => {
    const bundle = new KeyBundle();
    await bundle.generateIdentityKeyPair();
    await bundle.generateSignedPreKey();
    await bundle.generateOneTimePreKeys(5);

    const exported = bundle.exportForVault();

    const bundle2 = new KeyBundle();
    bundle2.importFromVault(exported);

    expect(bundle2.getIdentityPublicKey()).toEqual(bundle.getIdentityPublicKey());

    bundle.destroy();
    bundle2.destroy();
  });
});

describe('X3DH Handshake', () => {
  it('should produce matching shared secrets for both parties', async () => {
    // Alice (initiator)
    const aliceBundle = new KeyBundle();
    await aliceBundle.generateIdentityKeyPair();

    // Bob (responder)
    const bobBundle = new KeyBundle();
    await bobBundle.generateIdentityKeyPair();
    await bobBundle.generateSignedPreKey();
    await bobBundle.generateOneTimePreKeys(5);

    const bobPreKeyBundle = bobBundle.getPublicPreKeyBundle();

    // Alice performs X3DH with Bob's published bundle
    const aliceX3DH = await X3DHHandshake.initiatorAgree(
      {
        publicKey: aliceBundle.getIdentityPublicKey(),
        privateKey: aliceBundle.getIdentityPrivateKey(),
      },
      bobPreKeyBundle
    );

    expect(aliceX3DH.sharedSecret.length).toBe(32);
    expect(aliceX3DH.ephemeralPublicKey.length).toBe(32);

    // Bob computes shared secret from Alice's initial message
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

    // Both should derive the same shared secret
    expect(Buffer.from(aliceX3DH.sharedSecret).toString('hex'))
      .toBe(Buffer.from(bobSharedSecret).toString('hex'));

    aliceBundle.destroy();
    bobBundle.destroy();
  });

  it('should reject invalid signed pre-key', async () => {
    const aliceBundle = new KeyBundle();
    await aliceBundle.generateIdentityKeyPair();

    const bobBundle = new KeyBundle();
    await bobBundle.generateIdentityKeyPair();
    await bobBundle.generateSignedPreKey();

    const bundle = bobBundle.getPublicPreKeyBundle();

    // Tamper with the signed pre-key
    bundle.signedPreKey.publicKey = new Uint8Array(32).fill(0xaa);

    await expect(
      X3DHHandshake.initiatorAgree(
        {
          publicKey: aliceBundle.getIdentityPublicKey(),
          privateKey: aliceBundle.getIdentityPrivateKey(),
        },
        bundle
      )
    ).rejects.toThrow('Invalid signed pre-key signature');

    aliceBundle.destroy();
    bobBundle.destroy();
  });
});

describe('Double Ratchet', () => {
  it('should encrypt and decrypt messages bidirectionally', async () => {
    // Setup: perform X3DH first
    const aliceBundle = new KeyBundle();
    await aliceBundle.generateIdentityKeyPair();

    const bobBundle = new KeyBundle();
    await bobBundle.generateIdentityKeyPair();
    await bobBundle.generateSignedPreKey();
    await bobBundle.generateOneTimePreKeys(5);

    const bobPreKeyBundle = bobBundle.getPublicPreKeyBundle();

    // X3DH
    const aliceX3DH = await X3DHHandshake.initiatorAgree(
      {
        publicKey: aliceBundle.getIdentityPublicKey(),
        privateKey: aliceBundle.getIdentityPrivateKey(),
      },
      bobPreKeyBundle
    );

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

    // Initialize ratchets
    const aliceRatchet = await DoubleRatchet.initInitiator(
      aliceX3DH.sharedSecret,
      bobPreKeyBundle.signedPreKey.publicKey
    );

    const bobRatchet = await DoubleRatchet.initResponder(
      bobSharedSecret,
      {
        publicKey: bobPreKeyBundle.signedPreKey.publicKey,
        privateKey: bobBundle.getSignedPreKeyPrivate(),
      }
    );

    // Alice sends message to Bob
    const msg1 = new TextEncoder().encode('Hello Bob!');
    const encrypted1 = await aliceRatchet.encrypt(msg1);
    const decrypted1 = await bobRatchet.decrypt(encrypted1);
    expect(new TextDecoder().decode(decrypted1)).toBe('Hello Bob!');

    // Bob replies to Alice
    const msg2 = new TextEncoder().encode('Hello Alice!');
    const encrypted2 = await bobRatchet.encrypt(msg2);
    const decrypted2 = await aliceRatchet.decrypt(encrypted2);
    expect(new TextDecoder().decode(decrypted2)).toBe('Hello Alice!');

    // Alice sends another message
    const msg3 = new TextEncoder().encode('How are you?');
    const encrypted3 = await aliceRatchet.encrypt(msg3);
    const decrypted3 = await bobRatchet.decrypt(encrypted3);
    expect(new TextDecoder().decode(decrypted3)).toBe('How are you?');

    // Multiple messages from Bob
    const msg4 = new TextEncoder().encode('I am fine!');
    const encrypted4 = await bobRatchet.encrypt(msg4);
    const msg5 = new TextEncoder().encode('And you?');
    const encrypted5 = await bobRatchet.encrypt(msg5);

    // Decrypt in order
    const decrypted4 = await aliceRatchet.decrypt(encrypted4);
    const decrypted5 = await aliceRatchet.decrypt(encrypted5);
    expect(new TextDecoder().decode(decrypted4)).toBe('I am fine!');
    expect(new TextDecoder().decode(decrypted5)).toBe('And you?');

    aliceRatchet.destroy();
    bobRatchet.destroy();
    aliceBundle.destroy();
    bobBundle.destroy();
  });

  it('should handle out-of-order messages', async () => {
    // Abbreviated setup
    const aliceBundle = new KeyBundle();
    await aliceBundle.generateIdentityKeyPair();
    const bobBundle = new KeyBundle();
    await bobBundle.generateIdentityKeyPair();
    await bobBundle.generateSignedPreKey();
    await bobBundle.generateOneTimePreKeys(5);

    const bobPKB = bobBundle.getPublicPreKeyBundle();
    const aliceX3DH = await X3DHHandshake.initiatorAgree(
      { publicKey: aliceBundle.getIdentityPublicKey(), privateKey: aliceBundle.getIdentityPrivateKey() },
      bobPKB
    );

    let otpk: Uint8Array | undefined;
    if (aliceX3DH.usedOneTimePreKeyId !== undefined) {
      otpk = bobBundle.consumeOneTimePreKey(aliceX3DH.usedOneTimePreKeyId);
    }
    const bobSS = await X3DHHandshake.responderAgree(
      { publicKey: bobBundle.getIdentityPublicKey(), privateKey: bobBundle.getIdentityPrivateKey() },
      bobBundle.getSignedPreKeyPrivate(),
      aliceBundle.getIdentityPublicKey(),
      aliceX3DH.ephemeralPublicKey,
      otpk
    );

    const alice = await DoubleRatchet.initInitiator(aliceX3DH.sharedSecret, bobPKB.signedPreKey.publicKey);
    const bob = await DoubleRatchet.initResponder(bobSS, {
      publicKey: bobPKB.signedPreKey.publicKey,
      privateKey: bobBundle.getSignedPreKeyPrivate(),
    });

    // Alice sends 3 messages
    const enc1 = await alice.encrypt(new TextEncoder().encode('Message 1'));
    const enc2 = await alice.encrypt(new TextEncoder().encode('Message 2'));
    const enc3 = await alice.encrypt(new TextEncoder().encode('Message 3'));

    // Bob receives them out of order: 3, 1, 2
    const dec3 = await bob.decrypt(enc3);
    expect(new TextDecoder().decode(dec3)).toBe('Message 3');

    const dec1 = await bob.decrypt(enc1);
    expect(new TextDecoder().decode(dec1)).toBe('Message 1');

    const dec2 = await bob.decrypt(enc2);
    expect(new TextDecoder().decode(dec2)).toBe('Message 2');

    alice.destroy();
    bob.destroy();
    aliceBundle.destroy();
    bobBundle.destroy();
  });

  it('should reject tampered messages', async () => {
    const aliceBundle = new KeyBundle();
    await aliceBundle.generateIdentityKeyPair();
    const bobBundle = new KeyBundle();
    await bobBundle.generateIdentityKeyPair();
    await bobBundle.generateSignedPreKey();
    await bobBundle.generateOneTimePreKeys(1);

    const bobPKB = bobBundle.getPublicPreKeyBundle();
    const aliceX3DH = await X3DHHandshake.initiatorAgree(
      { publicKey: aliceBundle.getIdentityPublicKey(), privateKey: aliceBundle.getIdentityPrivateKey() },
      bobPKB
    );

    let otpk: Uint8Array | undefined;
    if (aliceX3DH.usedOneTimePreKeyId !== undefined) {
      otpk = bobBundle.consumeOneTimePreKey(aliceX3DH.usedOneTimePreKeyId);
    }
    const bobSS = await X3DHHandshake.responderAgree(
      { publicKey: bobBundle.getIdentityPublicKey(), privateKey: bobBundle.getIdentityPrivateKey() },
      bobBundle.getSignedPreKeyPrivate(),
      aliceBundle.getIdentityPublicKey(),
      aliceX3DH.ephemeralPublicKey,
      otpk
    );

    const alice = await DoubleRatchet.initInitiator(aliceX3DH.sharedSecret, bobPKB.signedPreKey.publicKey);
    const bob = await DoubleRatchet.initResponder(bobSS, {
      publicKey: bobPKB.signedPreKey.publicKey,
      privateKey: bobBundle.getSignedPreKeyPrivate(),
    });

    const encrypted = await alice.encrypt(new TextEncoder().encode('Secret'));

    // Tamper with ciphertext
    encrypted.ciphertext[0] ^= 0xff;

    await expect(bob.decrypt(encrypted)).rejects.toThrow('authentication error');

    alice.destroy();
    bob.destroy();
    aliceBundle.destroy();
    bobBundle.destroy();
  });
});

describe('Safety Number', () => {
  it('should produce same safety number regardless of key order', async () => {
    const s = await initCrypto();
    const keyA = s.crypto_sign_keypair().publicKey;
    const keyB = s.crypto_sign_keypair().publicKey;

    const sn1 = await SafetyNumber.compute(keyA, keyB);
    const sn2 = await SafetyNumber.compute(keyB, keyA);

    expect(sn1).toBe(sn2);
    expect(sn1.length).toBeGreaterThan(0);
  });

  it('should produce different safety numbers for different keys', async () => {
    const s = await initCrypto();
    const keyA = s.crypto_sign_keypair().publicKey;
    const keyB = s.crypto_sign_keypair().publicKey;
    const keyC = s.crypto_sign_keypair().publicKey;

    const sn1 = await SafetyNumber.compute(keyA, keyB);
    const sn2 = await SafetyNumber.compute(keyA, keyC);

    expect(sn1).not.toBe(sn2);
  });

  it('should produce blocks for display', async () => {
    const s = await initCrypto();
    const keyA = s.crypto_sign_keypair().publicKey;
    const keyB = s.crypto_sign_keypair().publicKey;

    const blocks = await SafetyNumber.computeBlocks(keyA, keyB);
    expect(blocks.length).toBeGreaterThan(0);
    for (const block of blocks) {
      expect(block.length).toBe(5);
      expect(/^\d{5}$/.test(block)).toBe(true);
    }
  });
});

describe('Recovery Code', () => {
  it('should generate and validate a recovery code', async () => {
    const { code, hash } = await generateRecoveryCode();

    expect(code).toBeTruthy();
    expect(code.includes('-')).toBe(true);
    expect(hash).toBeTruthy();

    const valid = await validateRecoveryCode(code, hash);
    expect(valid).toBe(true);

    const invalid = await validateRecoveryCode('0000-0000-0000-0000-0000-0000-0000-0000-0000-0000-0000-0000-0000-0000-0000-0000', hash);
    expect(invalid).toBe(false);
  });
});

describe('Local Vault', () => {
  it('should encrypt and decrypt vault data', async () => {
    const vault = new LocalVault();
    await vault.generateVaultKey();

    const data = {
      pgpPrivateKeyArmored: testPGPKey.privateKey,
      identityKeyPair: {
        publicKey: 'dGVzdA==',
        privateKey: 'c2VjcmV0',
      },
      keyBundleExport: '{}',
      ratchetSessions: {},
      deviceId: 'test-device',
      recoveryCodeHash: 'hash123',
      createdAt: Date.now(),
      version: 1,
    };

    const encrypted = await vault.encrypt(data);
    expect(typeof encrypted).toBe('string');

    const parsed = JSON.parse(encrypted);
    expect(parsed.nonce).toBeTruthy();
    expect(parsed.ciphertext).toBeTruthy();

    const decrypted = await vault.decrypt(encrypted);
    expect(decrypted.deviceId).toBe('test-device');
    expect(decrypted.pgpPrivateKeyArmored).toBe(testPGPKey.privateKey);

    vault.lock();
    expect(vault.isUnlocked()).toBe(false);
  });

  it('should fail decryption when locked', async () => {
    const vault = new LocalVault();
    await expect(vault.encrypt({} as any)).rejects.toThrow('Vault is locked');
  });
});
