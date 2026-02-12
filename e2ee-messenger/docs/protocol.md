# E2EE P2P Messenger Protocol Specification

**Version:** 1.0.0-draft
**Status:** Draft
**Last Updated:** 2026-02-12

---

## Table of Contents

1. [Overview](#1-overview)
2. [Identity Layer](#2-identity-layer)
3. [Key Agreement (X3DH)](#3-key-agreement-x3dh)
4. [Message Encryption (Double Ratchet)](#4-message-encryption-double-ratchet)
5. [Key Derivation Functions](#5-key-derivation-functions)
6. [Message Format](#6-message-format)
7. [Pre-key Management](#7-pre-key-management)
8. [Session Establishment](#8-session-establishment)
9. [Contact Verification](#9-contact-verification)
10. [Device Management](#10-device-management)
11. [Transport](#11-transport)
12. [Recovery](#12-recovery)
13. [Local Storage Security](#13-local-storage-security)

---

## 1. Overview

### 1.1 Design Goals

This protocol provides end-to-end encrypted peer-to-peer messaging with the following properties:

- **Confidentiality:** Only the intended sender and recipient can read message contents.
- **Authenticity:** Messages are cryptographically bound to the sender's identity.
- **Forward Secrecy:** Compromise of long-term keys does not compromise past session keys.
- **Post-Compromise Security (Future Secrecy):** Sessions self-heal after temporary key compromise through ratcheting.
- **Deniability:** No cryptographic proof ties a specific message to a specific sender from a third-party perspective.
- **Decentralization:** No central server is required for message relay; peers communicate directly when possible.

### 1.2 Cryptographic Primitives

| Function | Primitive | Notes |
|---|---|---|
| Identity Anchor | PGP (OpenPGP, RFC 4880) | Long-term identity, web of trust |
| Messaging Identity | Ed25519 | Signing, converted to X25519 for DH |
| Key Exchange | X25519 (Curve25519 ECDH) | All DH operations |
| Symmetric Encryption | XChaCha20-Poly1305 | AEAD with 192-bit nonces |
| Key Derivation | BLAKE2b | HKDF-like construction (see Section 5) |
| Hashing | BLAKE2b-256 / BLAKE2b-512 | General-purpose hashing |
| Signatures | Ed25519 | Pre-key signing, attestations |

### 1.3 Relationship to the Signal Protocol

This protocol is based on the Signal Protocol's X3DH key agreement and Double Ratchet algorithm as described in:

- [X3DH Key Agreement Protocol](https://signal.org/docs/specifications/x3dh/) (Marlinspike & Perrin, 2016)
- [The Double Ratchet Algorithm](https://signal.org/docs/specifications/doubleratchet/) (Perrin & Marlinspike, 2016)

**Key departures from Signal's reference implementation:**

| Component | Signal Reference | This Protocol |
|---|---|---|
| Hash function | SHA-256 / SHA-512 | BLAKE2b-256 / BLAKE2b-512 |
| AEAD cipher | AES-256-CBC + HMAC-SHA-256 | XChaCha20-Poly1305 |
| KDF | HKDF (RFC 5869, SHA-256) | BLAKE2b-based HKDF-like (see Section 5) |
| Identity anchor | Phone number | PGP key |
| Transport | Central server relay | WebRTC P2P / WebSocket fallback |

BLAKE2b was chosen for its superior performance in software implementations (especially on platforms without AES-NI), its resistance to length-extension attacks without requiring HMAC wrapping, and its built-in keying and personalization support. XChaCha20-Poly1305 was chosen for its 192-bit nonce space (eliminating nonce collision concerns in multi-device scenarios), constant-time software implementations, and avoidance of AES side-channel attack surfaces on platforms lacking hardware AES support.

---

## 2. Identity Layer

### 2.1 PGP as Identity Anchor

Each user possesses a PGP key pair that serves as their root of trust. The PGP key is the canonical identity and is used for:

- Human-meaningful identity (name, email bound to key via OpenPGP User IDs)
- Web-of-trust integration (cross-signatures with other PGP keys)
- Device authorization (signing attestations that bind messaging keys to the PGP identity)
- Key recovery authorization

The PGP key is **never used directly** for message encryption or key agreement. It exists solely as an identity anchor and attestation authority.

**Requirements for the PGP key:**

- Minimum 4096-bit RSA or Ed25519/Cv25519 (preferred)
- Must have at least one User ID with a valid self-signature
- Expiration is recommended but not required by the protocol
- Revocation certificates should be generated at key creation time and stored securely offline

### 2.2 Ed25519 Messaging Identity Key (IK)

Each device generates a long-term Ed25519 key pair for use in the messaging protocol:

```
IK_priv: 32 bytes, generated from a CSPRNG
IK_pub:  32 bytes, the Ed25519 public key
```

The Ed25519 identity key serves as the `IK` in X3DH. For Diffie-Hellman operations, it is converted to X25519 using the birational map between the Ed25519 (twisted Edwards) and X25519 (Montgomery) curve forms, as specified in RFC 7748 and implemented in libsodium's `crypto_sign_ed25519_pk_to_curve25519` / `crypto_sign_ed25519_sk_to_curve25519`.

```
IK_dh_priv = Ed25519_sk_to_X25519(IK_priv)
IK_dh_pub  = Ed25519_pk_to_X25519(IK_pub)
```

### 2.3 Attestation Binding

An **identity attestation** cryptographically binds a device's Ed25519 messaging identity key to the user's PGP identity. The attestation is a PGP-signed statement with the following structure:

```
Attestation := PGP_Sign(PGP_priv, AttestationPayload)

AttestationPayload := {
    version:        uint8  = 0x01
    timestamp:      uint64 (Unix epoch, seconds)
    ik_fingerprint: BLAKE2b-256(IK_pub)
    device_id:      16 bytes (random, assigned at device registration)
    device_label:   UTF-8 string (human-readable device name)
    purpose:        uint8  = 0x01 (DEVICE_AUTHORIZATION)
}
```

**Verification procedure:**

1. Verify the PGP signature over `AttestationPayload` using the signer's PGP public key.
2. Verify that the `ik_fingerprint` matches `BLAKE2b-256(IK_pub)` of the claimed identity key.
3. Verify that the `timestamp` is within an acceptable window (recommended: not older than 365 days).
4. Verify the PGP key has not been revoked.
5. Optionally, verify the PGP key against a known trust path (web of trust).

Peers must verify the attestation before establishing a session. A valid attestation proves that the holder of the PGP private key authorized this Ed25519 identity key for messaging.

### 2.4 Identity Key Fingerprint

For display and out-of-band verification, identity keys are represented as:

```
Fingerprint := BLAKE2b-256(IK_pub)
```

Rendered as 64 hexadecimal characters, optionally grouped for readability:

```
a1b2c3d4 e5f6a7b8 c9d0e1f2 a3b4c5d6
e7f8a9b0 c1d2e3f4 a5b6c7d8 e9f0a1b2
```

---

## 3. Key Agreement (X3DH)

### 3.1 Overview

The Extended Triple Diffie-Hellman (X3DH) protocol provides mutual authentication, forward secrecy, and deniability during initial key agreement. This protocol follows the X3DH specification with modifications for our cryptographic primitive choices.

### 3.2 Key Types

Each participant maintains the following key material:

| Key | Type | Lifetime | Purpose |
|---|---|---|---|
| Identity Key (IK) | Ed25519 (converted to X25519 for DH) | Long-term | Authentication, DH exchange |
| Signed Pre-Key (SPK) | X25519 | Medium-term (7-day rotation) | DH exchange, forward secrecy |
| SPK Signature | Ed25519 signature | Bound to SPK | Authenticates SPK |
| One-Time Pre-Keys (OPK) | X25519 | Single-use | Additional forward secrecy |

### 3.3 Pre-key Bundle

A user publishes a **pre-key bundle** to enable asynchronous session establishment. The bundle contains:

```
PreKeyBundle := {
    ik_pub:         IK_pub (Ed25519, 32 bytes)
    spk_pub:        SPK_pub (X25519, 32 bytes)
    spk_id:         uint32
    spk_signature:  Ed25519_Sign(IK_priv, Encode(SPK_pub))
    opk_pub:        OPK_pub (X25519, 32 bytes) [optional]
    opk_id:         uint32 [present iff opk_pub is present]
    attestation:    Attestation (see Section 2.3)
}
```

The `spk_signature` is computed as:

```
spk_signature = Ed25519_Sign(IK_priv, SPK_pub || ENCODE("E2EEMessengerSPK"))
```

The domain-separation tag `"E2EEMessengerSPK"` prevents cross-protocol signature confusion.

### 3.4 X3DH Protocol Execution

**Initiator (Alice) sends to Responder (Bob):**

Alice fetches Bob's pre-key bundle and verifies:

1. The attestation binds `IK_Bob` to a trusted PGP identity.
2. `Ed25519_Verify(IK_Bob, SPK_Bob || ENCODE("E2EEMessengerSPK"), spk_signature)` succeeds.

Alice generates an ephemeral X25519 key pair:

```
EK_priv, EK_pub = X25519_Generate()
```

Alice computes four DH operations:

```
DH1 = X25519(IK_Alice_dh_priv, SPK_Bob)        # Alice's identity, Bob's signed pre-key
DH2 = X25519(EK_priv, IK_Bob_dh_pub)            # Alice's ephemeral, Bob's identity
DH3 = X25519(EK_priv, SPK_Bob)                  # Alice's ephemeral, Bob's signed pre-key
DH4 = X25519(EK_priv, OPK_Bob)                  # Alice's ephemeral, Bob's one-time pre-key [if available]
```

If no one-time pre-key is available, DH4 is omitted.

### 3.5 Shared Secret Derivation

The shared secret is derived using the BLAKE2b-based KDF (see Section 5):

```
F = 0xFF repeated 32 times (padding constant)

If OPK was used:
    input = F || DH1 || DH2 || DH3 || DH4
Else:
    input = F || DH1 || DH2 || DH3

SK = KDF(
    salt:  zeroed 32 bytes,
    ikm:   input,
    info:  "E2EEMessenger_X3DH",
    len:   32
)
```

The 32 bytes of `0xFF` prepended to the DH outputs ensure that the KDF input is never a low-entropy value, even in degenerate cases.

`SK` (the shared secret, 32 bytes) becomes the initial root key for the Double Ratchet.

### 3.6 Associated Data

The associated data for the initial message is:

```
AD = IK_Alice_pub || IK_Bob_pub
```

This binds the session to both parties' long-term identity keys, preventing unknown key-share attacks.

### 3.7 Initial Message

Alice sends to Bob:

```
InitialMessage := {
    ik_pub:     IK_Alice_pub (Ed25519, 32 bytes)
    ek_pub:     EK_pub (X25519, 32 bytes)
    spk_id:     uint32 (identifies which SPK was used)
    opk_id:     uint32 [present iff OPK was used]
    message:    <first Double Ratchet message, see Section 6>
}
```

### 3.8 Receiving the Initial Message

Bob, upon receiving an initial message:

1. Loads the private keys corresponding to `spk_id` and (if present) `opk_id`.
2. Verifies Alice's attestation to confirm `IK_Alice_pub` is bound to a known PGP identity.
3. Computes the same four (or three) DH operations from his side.
4. Derives `SK` using the same KDF procedure.
5. Deletes the one-time pre-key (if used) to ensure forward secrecy.
6. Initializes the Double Ratchet with `SK` as the root key.

### 3.9 Security Properties

| Property | Guaranteed? | Notes |
|---|---|---|
| Mutual authentication | Yes | Both IKs contribute to the shared secret |
| Forward secrecy | Yes | Ephemeral key EK is deleted after use; OPK provides additional forward secrecy |
| Deniability | Yes | No non-repudiable signatures over message content; any party could have computed the DH results |
| Asynchronous | Yes | Bob does not need to be online; Alice uses his pre-key bundle |

---

## 4. Message Encryption (Double Ratchet)

### 4.1 Overview

After X3DH establishes the initial shared secret, all subsequent message encryption uses the Double Ratchet algorithm. The Double Ratchet combines:

1. A **DH ratchet** (asymmetric ratchet) that provides post-compromise security.
2. A **symmetric-key ratchet** that derives per-message keys.

Together, these ensure that every message is encrypted with a unique key, past messages cannot be decrypted even if current keys are compromised, and sessions recover from compromise as soon as a DH ratchet step occurs.

### 4.2 State

Each party maintains the following ratchet state:

```
RatchetState := {
    DHs:    X25519 key pair (current DH sending key pair)
    DHr:    X25519 public key (current DH receiving key, peer's ratchet public key)
    RK:     32 bytes (root key)
    CKs:    32 bytes (sending chain key)
    CKr:    32 bytes (receiving chain key)
    Ns:     uint32 (message number for sending chain)
    Nr:     uint32 (message number for receiving chain)
    PN:     uint32 (previous sending chain length)
    MKSKIPPED: dictionary of (ratchet_pub, message_number) -> message_key
}
```

### 4.3 Initialization

**Initiator (Alice, who sent the X3DH initial message):**

```
state.SK   = SK (from X3DH)
state.DHs  = X25519_Generate()  # Alice's first ratchet key pair
state.DHr  = SPK_Bob            # Bob's signed pre-key as initial DH receiving key
state.RK, state.CKs = KDF_RK(SK, X25519(state.DHs.priv, state.DHr))
state.CKr  = empty
state.Ns   = 0
state.Nr   = 0
state.PN   = 0
```

**Responder (Bob, who received the X3DH initial message):**

```
state.SK   = SK (from X3DH)
state.DHs  = SPK_Bob_keypair    # Bob's signed pre-key pair as initial DH key
state.DHr  = empty              # Will be set upon receiving Alice's first message
state.RK   = SK
state.CKs  = empty
state.CKr  = empty
state.Ns   = 0
state.Nr   = 0
state.PN   = 0
```

### 4.4 DH Ratchet Step

A DH ratchet step occurs whenever a message is received containing a new ratchet public key (i.e., `header.dh != state.DHr`).

```
DH_Ratchet(state, header):
    state.PN   = state.Ns
    state.Ns   = 0
    state.Nr   = 0
    state.DHr  = header.dh
    state.RK, state.CKr = KDF_RK(state.RK, X25519(state.DHs.priv, state.DHr))
    state.DHs  = X25519_Generate()
    state.RK, state.CKs = KDF_RK(state.RK, X25519(state.DHs.priv, state.DHr))
```

Each DH ratchet step performs **two** KDF_RK operations: one to derive a new receiving chain key, and one to derive a new sending chain key with a freshly generated DH key pair. This ensures both forward secrecy and post-compromise security.

### 4.5 Symmetric-Key Ratchet

The symmetric-key ratchet advances the chain key to produce a message key for each message:

```
KDF_CK(ck):
    mk = BLAKE2b-256(key=ck, input=0x01)   # Message key
    ck_next = BLAKE2b-256(key=ck, input=0x02)  # Next chain key
    return ck_next, mk
```

### 4.6 Encrypting a Message

```
Encrypt(state, plaintext, associated_data):
    state.CKs, mk = KDF_CK(state.CKs)
    header = Header(
        dh:  state.DHs.pub,
        pn:  state.PN,
        n:   state.Ns
    )
    state.Ns += 1
    nonce = BLAKE2b(key=mk, input="E2EEMessenger_nonce", len=24)
    ciphertext = XChaCha20_Poly1305_Encrypt(
        key:   mk,
        nonce: nonce,
        aad:   associated_data || Encode(header),
        plaintext: plaintext
    )
    return header, nonce, ciphertext
```

### 4.7 Decrypting a Message

```
Decrypt(state, header, nonce, ciphertext, associated_data):
    # Check for skipped message keys
    if (header.dh, header.n) in state.MKSKIPPED:
        mk = state.MKSKIPPED.pop((header.dh, header.n))
        return XChaCha20_Poly1305_Decrypt(mk, nonce, aad, ciphertext)

    # DH ratchet step if new ratchet key
    if header.dh != state.DHr:
        SkipMessageKeys(state, header.pn)  # Skip remaining keys in current receiving chain
        DH_Ratchet(state, header)

    SkipMessageKeys(state, header.n)       # Skip keys up to header.n in new chain
    state.CKr, mk = KDF_CK(state.CKr)
    state.Nr += 1

    return XChaCha20_Poly1305_Decrypt(
        key:   mk,
        nonce: nonce,
        aad:   associated_data || Encode(header),
        ciphertext: ciphertext
    )
```

### 4.8 Skipped Message Keys

Out-of-order messages are handled by pre-computing and storing skipped message keys:

```
SkipMessageKeys(state, until):
    if state.Nr + MAX_SKIP < until:
        raise TooManySkippedKeysError
    while state.Nr < until:
        state.CKr, mk = KDF_CK(state.CKr)
        state.MKSKIPPED[(state.DHr, state.Nr)] = mk
        state.Nr += 1
```

`MAX_SKIP` is set to **1000** to limit storage and prevent denial-of-service via excessively large message numbers. Skipped message keys are stored for a maximum of **30 days** or **2000 keys** (whichever limit is reached first), after which they are deleted and the corresponding messages become undecryptable.

---

## 5. Key Derivation Functions

### 5.1 BLAKE2b-based HKDF-like Construction

This protocol uses BLAKE2b in place of HMAC-SHA-256 within an HKDF-like (RFC 5869) construction. BLAKE2b natively supports a keying parameter, making the HMAC wrapper unnecessary.

The construction has two phases: **Extract** and **Expand**.

### 5.2 Extract Phase

```
KDF_Extract(salt, ikm) -> prk
    prk = BLAKE2b-256(key=salt, input=ikm)
```

If `salt` is not provided, a zeroed 32-byte string is used as the key. This mirrors HKDF-Extract but uses BLAKE2b's built-in keying instead of HMAC.

### 5.3 Expand Phase

```
KDF_Expand(prk, info, length) -> okm
    n = ceil(length / 32)
    T(0) = empty string
    T(i) = BLAKE2b-256(key=prk, input=T(i-1) || info || byte(i))  for i = 1..n
    okm  = T(1) || T(2) || ... || T(n), truncated to 'length' bytes
```

### 5.4 Combined KDF

```
KDF(salt, ikm, info, len) -> okm
    prk = KDF_Extract(salt, ikm)
    okm = KDF_Expand(prk, info, len)
    return okm
```

### 5.5 Root Key Derivation (KDF_RK)

Used in the DH ratchet step to derive a new root key and chain key:

```
KDF_RK(rk, dh_out) -> (new_rk, chain_key)
    okm = KDF(salt=rk, ikm=dh_out, info="E2EEMessenger_RootRatchet", len=64)
    new_rk    = okm[0:32]
    chain_key = okm[32:64]
    return (new_rk, chain_key)
```

### 5.6 Chain Key Derivation (KDF_CK)

Used in the symmetric-key ratchet to derive a message key and advance the chain:

```
KDF_CK(ck) -> (new_ck, message_key)
    message_key = BLAKE2b-256(key=ck, input=0x01)
    new_ck      = BLAKE2b-256(key=ck, input=0x02)
    return (new_ck, message_key)
```

The single-byte inputs `0x01` and `0x02` provide domain separation between message key and chain key derivation, following the same pattern as the Signal Protocol's symmetric ratchet.

### 5.7 Domain Separation Constants

All KDF `info` strings use the prefix `"E2EEMessenger_"` to provide domain separation from other protocols using the same primitives:

| Context | Info String |
|---|---|
| X3DH shared secret | `"E2EEMessenger_X3DH"` |
| Root ratchet | `"E2EEMessenger_RootRatchet"` |
| Nonce derivation | `"E2EEMessenger_nonce"` |
| Vault key (recovery) | `"E2EEMessenger_VaultKey"` |
| Device key derivation | `"E2EEMessenger_DeviceKey"` |
| Safety number | `"E2EEMessenger_SafetyNumber"` |

---

## 6. Message Format

### 6.1 Wire Format

All multi-byte integers are encoded in **big-endian** (network byte order). The complete encrypted message is serialized as follows:

```
EncryptedMessage := {
    version:    uint8  = 0x01
    header:     Header
    nonce:      24 bytes
    ciphertext: variable length (plaintext + 16-byte Poly1305 tag)
}
```

### 6.2 Header

```
Header := {
    dh_pub:     32 bytes (sender's current DH ratchet public key, X25519)
    pn:         uint32   (previous sending chain length)
    n:          uint32   (message number in current sending chain)
}
```

Total header size: **40 bytes**.

The header is transmitted **in the clear** (not encrypted) because the receiver needs the `dh_pub` to perform the DH ratchet step before decryption. However, the header is included in the AEAD associated data, ensuring its integrity.

### 6.3 Nonce

The nonce for XChaCha20-Poly1305 is **24 bytes**, derived deterministically from the message key:

```
nonce = BLAKE2b(key=mk, input="E2EEMessenger_nonce", len=24)
```

Because each message key `mk` is unique (derived from a ratcheting chain key), the derived nonce is unique per message. The 192-bit nonce space of XChaCha20 provides a large safety margin against accidental nonce reuse, particularly in multi-device contexts.

### 6.4 Associated Data (AAD)

The associated data fed into the AEAD construction binds the ciphertext to the session identities and the message header:

```
AAD = IK_sender_pub || IK_recipient_pub || Encode(header)
```

Where `Encode(header)` is the serialized header bytes. This prevents:

- **Identity misdirection:** An attacker cannot redirect a message to a different recipient.
- **Header tampering:** Modifying the header will cause AEAD decryption to fail.

### 6.5 Plaintext Envelope

Before encryption, the plaintext is structured as:

```
PlaintextEnvelope := {
    content_type:  uint8
    timestamp:     uint64 (Unix epoch, milliseconds)
    body:          variable length (content bytes)
    padding:       variable length (random bytes to reach target size)
}
```

**Content Types:**

| Value | Type | Description |
|---|---|---|
| `0x01` | TEXT | UTF-8 text message |
| `0x02` | FILE_META | File transfer metadata |
| `0x03` | FILE_CHUNK | File data chunk |
| `0x04` | RECEIPT | Delivery/read receipt |
| `0x05` | TYPING | Typing indicator |
| `0x06` | CONTROL | Session control (key rotation notice, session reset) |
| `0x07` | REACTION | Message reaction |

### 6.6 Padding

All plaintext is padded to the nearest multiple of **256 bytes** to resist traffic analysis based on message length. Padding bytes are filled with output from a CSPRNG. The padding length is encoded in the last byte of the padded plaintext (if padding length < 256) or in the last two bytes (big-endian uint16) if a two-byte length field is needed. The receiver strips padding after decryption.

---

## 7. Pre-key Management

### 7.1 Signed Pre-Key (SPK) Rotation

Signed pre-keys are rotated on the following schedule:

| Parameter | Value |
|---|---|
| Rotation interval | **7 days** |
| Grace period (keep old SPK) | **14 days** after rotation |
| Maximum SPK age | **21 days** (7-day active + 14-day grace) |

**Rotation procedure:**

1. Generate a new X25519 key pair: `SPK_new_priv, SPK_new_pub`.
2. Sign the new SPK with the identity key: `sig = Ed25519_Sign(IK_priv, SPK_new_pub || "E2EEMessengerSPK")`.
3. Assign a new `spk_id` (monotonically increasing uint32).
4. Publish the new SPK and signature to available discovery/relay channels.
5. Retain the old SPK private key for the grace period to decrypt messages from peers who fetched the old bundle.
6. After the grace period expires, securely delete the old SPK private key.

If a device is offline for longer than the rotation interval, it must rotate the SPK immediately upon coming back online.

### 7.2 One-Time Pre-Key (OPK) Management

One-time pre-keys provide an additional layer of forward secrecy for the X3DH initial exchange.

| Parameter | Value |
|---|---|
| Initial OPK count | **100** |
| Replenishment threshold | **25** remaining |
| Replenishment batch size | **75** (to restore count to 100) |
| Maximum stored OPKs | **200** |

**Lifecycle of an OPK:**

1. **Generation:** The device generates X25519 key pairs and assigns each a unique `opk_id`.
2. **Publication:** OPK public keys and IDs are published alongside the pre-key bundle.
3. **Consumption:** When a peer uses an OPK in an X3DH exchange, the corresponding private key is consumed.
4. **Deletion:** Upon receiving an initial message referencing an `opk_id`, the device deletes the corresponding OPK private key after successfully deriving the session key.

**Replenishment triggers:**

- The local device detects its published OPK count has dropped below the replenishment threshold.
- On each device wake-up or reconnection, the device checks and replenishes if needed.

### 7.3 Pre-key Distribution

In the absence of a central server, pre-key bundles are distributed via:

1. **Direct exchange:** When both peers are online, bundles are exchanged via the transport layer (Section 11).
2. **Relay cache:** A lightweight relay node (WebSocket server) can cache pre-key bundles for offline peers. The relay sees only public keys and cannot derive session secrets.
3. **DHT publication:** For fully decentralized operation, bundles may be published to a Kademlia-style DHT, keyed by a hash of the user's PGP fingerprint.

All distribution channels carry only public key material and PGP-signed attestations; no private key material ever leaves the device.

---

## 8. Session Establishment

### 8.1 Initiator Flow (Alice -> Bob)

```
1.  Alice resolves Bob's identity (PGP fingerprint or User ID).
2.  Alice fetches Bob's pre-key bundle (from relay, DHT, or direct exchange).
3.  Alice verifies Bob's PGP attestation over IK_Bob.
4.  Alice verifies the SPK signature: Ed25519_Verify(IK_Bob, SPK_Bob || tag, sig).
5.  Alice generates ephemeral key pair EK.
6.  Alice computes DH1..DH4 (or DH1..DH3 if no OPK available).
7.  Alice derives SK via KDF (Section 5).
8.  Alice initializes Double Ratchet state (Section 4.3, initiator role).
9.  Alice constructs the initial message (Section 3.7) containing:
        - Her IK_pub, EK_pub, SPK ID, OPK ID (if used)
        - The first Double Ratchet encrypted message
10. Alice sends the initial message to Bob via transport (Section 11).
11. Alice deletes EK_priv.
12. Session is established on Alice's side; she can continue sending messages.
```

### 8.2 Responder Flow (Bob receives Alice's initial message)

```
1.  Bob receives the initial message.
2.  Bob extracts IK_Alice_pub, EK_pub, spk_id, opk_id.
3.  Bob looks up the private keys for spk_id and opk_id.
4.  Bob verifies Alice's PGP attestation over IK_Alice.
5.  Bob computes DH1..DH4 (or DH1..DH3) from his side.
6.  Bob derives SK via KDF (same as Alice).
7.  Bob initializes Double Ratchet state (Section 4.3, responder role).
8.  Bob decrypts the first message using the Double Ratchet.
9.  Bob deletes the OPK private key (if one was used).
10. Session is established on Bob's side; he can now send and receive.
```

### 8.3 Session Reset

If a session becomes corrupted (e.g., due to state desynchronization), either party may initiate a session reset:

1. The initiating party sends a `CONTROL` message (content type `0x06`) with a reset flag via the old session (if possible) or out-of-band.
2. Both parties delete all ratchet state for the session.
3. The initiating party fetches a fresh pre-key bundle and performs X3DH again.
4. A new session is established with a fresh shared secret.

Session resets trigger a safety number change (Section 9), which must be communicated to the user.

### 8.4 Simultaneous Initiation

If both Alice and Bob simultaneously send initial messages to each other (each performing X3DH independently), the following tie-breaking rule applies:

- Compare `IK_Alice_pub` and `IK_Bob_pub` lexicographically (as raw 32-byte strings).
- The party with the **lexicographically lower** identity public key's session wins.
- The other party discards their initiated session and accepts the winning session.

---

## 9. Contact Verification

### 9.1 Safety Numbers

Safety numbers allow users to verify they are communicating with the intended party and detect man-in-the-middle attacks. A safety number is a numeric representation of both parties' identity keys.

**Computation:**

```
SafetyNumber(IK_A, IK_B):
    For each party X in {A, B}:
        digest_X = BLAKE2b(
            key:   "E2EEMessenger_SafetyNumber",
            input: IK_X_pub || PGP_Fingerprint_X,
            len:   32
        )
        # Iterative hashing for slow comparison resistance
        for i in 1..5200:
            digest_X = BLAKE2b(
                input: digest_X || IK_X_pub || PGP_Fingerprint_X,
                len:   32
            )
        numeric_X = ""
        for j in 0..4:
            chunk = BigEndian_uint32(digest_X[j*4 .. j*4+4]) mod 100000
            numeric_X += ZeroPad(chunk, 5)  # 5-digit group

    # Concatenate in deterministic order: lower identity first
    if IK_A_pub < IK_B_pub (lexicographic):
        return numeric_A || " " || numeric_B
    else:
        return numeric_B || " " || numeric_A
```

This yields a **60-digit** safety number (two groups of 30 digits, each group consisting of six 5-digit segments). The number is stable as long as both parties' identity keys remain unchanged.

### 9.2 Display Format

Safety numbers are displayed as:

```
12345 67890 12345 67890 12345 67890
12345 67890 12345 67890 12345 67890
```

The first line corresponds to the party with the lexicographically lower IK, ensuring both users see the identical number.

### 9.3 QR Code Verification

For in-person verification, a QR code encodes:

```
QRPayload := {
    version:          uint8 = 0x01
    ik_pub:           32 bytes (scanner's identity public key)
    pgp_fingerprint:  20 bytes (scanner's PGP key fingerprint)
}
```

**Verification flow:**

1. Alice displays her QR code.
2. Bob scans Alice's QR code.
3. Bob's device extracts `IK_Alice_pub` and `PGP_Fingerprint_Alice` from the QR payload.
4. Bob's device compares these against the values stored in his local session state.
5. If they match, Bob's device marks Alice as **verified**.
6. They repeat the process with Bob displaying and Alice scanning.

Once both parties have scanned and verified, the contact is marked as **mutually verified**. The UI should clearly distinguish between verified and unverified contacts.

### 9.4 Verification Persistence

Verification status is stored locally and bound to the specific `IK_pub` of the contact. If a contact's identity key changes (e.g., due to device change or reinstallation), the verification status is reset and the user is warned.

---

## 10. Device Management

### 10.1 Multi-Device Architecture

A single user identity (PGP key) may be associated with multiple devices. Each device has:

- Its own Ed25519 identity key pair (IK)
- Its own pre-key material (SPK, OPKs)
- Its own ratchet sessions with each peer
- A unique `device_id` (16 random bytes, assigned at registration)

Peers maintain **separate sessions** with each of a user's devices. There is no shared ratchet state between devices of the same user.

### 10.2 Device Authorization

A new device is authorized by creating a PGP attestation (Section 2.3):

```
1. New device generates IK_new.
2. New device presents IK_new_pub to the user.
3. User signs an attestation binding IK_new_pub to their PGP identity:
       Attestation = PGP_Sign(PGP_priv, {
           version: 0x01,
           timestamp: now(),
           ik_fingerprint: BLAKE2b-256(IK_new_pub),
           device_id: random(16),
           device_label: "Phone" / "Laptop" / etc.,
           purpose: 0x01 (DEVICE_AUTHORIZATION)
       })
4. The attestation is distributed to peers along with the new device's pre-key bundle.
5. Peers verify the attestation before establishing sessions with the new device.
```

### 10.3 Device List

Each user maintains a signed device list:

```
DeviceList := PGP_Sign(PGP_priv, {
    version:     uint8 = 0x01
    timestamp:   uint64
    devices:     [
        {
            device_id:       16 bytes
            ik_fingerprint:  32 bytes (BLAKE2b-256 of device's IK_pub)
            device_label:    UTF-8 string
            added_at:        uint64 (Unix timestamp)
            status:          uint8 (0x01 = ACTIVE, 0x02 = REVOKED)
        },
        ...
    ]
})
```

Peers should fetch and verify the device list periodically and establish sessions only with devices listed as `ACTIVE`.

### 10.4 Device Revocation

A device is revoked by:

1. Updating the device list with the device's status set to `REVOKED`.
2. Signing the updated device list with the PGP key.
3. Distributing the updated device list to all peers.

Upon receiving a device list with a revoked device:

1. Peers terminate all active sessions with the revoked device.
2. Peers delete all stored pre-key material for the revoked device.
3. Peers refuse to establish new sessions with the revoked device.

**Emergency revocation:** If the PGP key itself is compromised, the user must use their PGP revocation certificate to revoke the PGP key. All peers who receive the revocation notice should terminate all sessions with all of that user's devices and refuse further communication until a new PGP key is established through an out-of-band channel.

### 10.5 Message Fanout

When sending a message to a multi-device user:

1. The sender encrypts the message separately for each of the recipient's active devices (separate ratchet sessions).
2. The sender also encrypts the message to each of their own other devices (for message synchronization).
3. Each encrypted copy is sent independently via the transport layer.

This "sender keys" approach is not used; instead, each device-to-device session is independent. This avoids the complexity of group key agreement for multi-device sync while accepting the O(n) encryption overhead per message (where n is the total number of active devices across sender and recipient).

---

## 11. Transport

### 11.1 Overview

The protocol is transport-agnostic at the cryptographic layer. All messages are fully encrypted before being handed to the transport. Two transport mechanisms are supported, with preference given to direct peer-to-peer connections.

### 11.2 WebRTC DataChannels (Preferred)

**Connection establishment:**

1. Peers exchange signaling data (SDP offers/answers, ICE candidates) via an out-of-band signaling channel (WebSocket relay, DHT, or any mutually reachable channel).
2. ICE negotiation proceeds with STUN for NAT traversal and TURN as a relay of last resort.
3. A DTLS-SRTP handshake secures the WebRTC connection at the transport layer.
4. A DataChannel is opened in **reliable, ordered** mode for message delivery.

**Configuration:**

| Parameter | Value |
|---|---|
| DataChannel label | `"e2ee-msg"` |
| Ordered | `true` |
| Max retransmits | `null` (reliable mode) |
| DTLS fingerprint verification | Recommended but not required (E2EE provides its own authentication) |

**Note on layered encryption:** WebRTC's DTLS layer provides transport encryption, but this is **not relied upon** for confidentiality or authentication. All messages are E2EE at the application layer before being sent over the DataChannel. The DTLS layer provides defense-in-depth and protects message metadata from passive network observers.

### 11.3 WebSocket Relay Fallback

When direct P2P connectivity is not possible (e.g., symmetric NATs, restrictive firewalls):

1. Both peers connect to a mutually agreed-upon WebSocket relay server.
2. Peers authenticate to the relay using a challenge-response protocol tied to their Ed25519 identity key.
3. The relay forwards opaque encrypted messages between peers.

**Relay protocol:**

```
RelayEnvelope := {
    version:      uint8 = 0x01
    recipient_id: BLAKE2b-256(IK_recipient_pub)  # 32 bytes, used for routing
    sender_id:    BLAKE2b-256(IK_sender_pub)      # 32 bytes
    payload:      EncryptedMessage (opaque to relay)
    timestamp:    uint64 (relay-assigned, for ordering/TTL)
}
```

The relay:

- **Cannot** read message contents (messages are E2EE).
- **Cannot** forge messages (AEAD authentication).
- **Can** observe metadata: who is communicating, when, and message sizes.
- **Should** enforce a TTL on stored messages (recommended: 30 days) and delete expired messages.

### 11.4 Signaling Channel

For WebRTC connection establishment, a signaling channel is required to exchange SDP and ICE candidates. This can be:

1. A dedicated WebSocket signaling server (simplest deployment).
2. A shared DHT (for fully decentralized operation).
3. Any authenticated side channel (e.g., exchanged via an already-established E2EE session to a different device).

Signaling messages are **not confidential** (they contain only connection negotiation data, not message content), but they should be **authenticated** to prevent connection hijacking. Signaling messages are signed with the sender's Ed25519 identity key:

```
SignedSignaling := {
    payload:   SDP/ICE data (UTF-8)
    sender_ik: IK_pub (32 bytes)
    signature: Ed25519_Sign(IK_priv, payload || recipient_ik_pub)
}
```

The recipient verifies the signature using the sender's known IK_pub before processing the signaling data.

---

## 12. Recovery

### 12.1 Overview

Recovery allows a user to restore their messaging identity and session data on a new device after loss of all existing devices. The recovery mechanism is designed such that no third party (including relay operators) can access the recovery data.

### 12.2 Recovery Code

At account setup, the user is presented with a **recovery code**:

```
recovery_code: 256 bits, generated from a CSPRNG
```

The recovery code is displayed to the user as a **24-word mnemonic** using BIP-39 word list encoding, or as a **64-character hexadecimal string**, at the user's choice.

Example (mnemonic):

```
abandon ability able about above absent absorb abstract absurd abuse
access accident account accuse achieve acid acoustic acquire across act
action actor adapt add address
```

The user must store this recovery code securely (e.g., written on paper, in a password manager). **The recovery code is never stored on-device after initial display.**

### 12.3 Vault Key Derivation

The vault key is derived from the recovery code and a random salt:

```
salt = random(32)  # Generated at vault creation time, stored with the vault

vault_key = KDF(
    salt:  salt,
    ikm:   recovery_code,
    info:  "E2EEMessenger_VaultKey",
    len:   32
)
```

Additionally, a memory-hard KDF (Argon2id) is applied to resist brute-force attacks on the recovery code:

```
vault_key = Argon2id(
    password:  recovery_code (32 bytes),
    salt:      salt (32 bytes),
    time:      3 iterations,
    memory:    256 MiB,
    threads:   4,
    output:    32 bytes
)
```

The Argon2id parameters are chosen to require approximately 1-2 seconds on a modern device, making brute-force attacks against the 256-bit recovery code computationally infeasible.

### 12.4 Encrypted Vault Contents

The vault contains the minimum state needed to restore a user's identity:

```
VaultPayload := {
    version:          uint8 = 0x01
    pgp_private_key:  OpenPGP private key (encrypted with its own passphrase)
    ik_priv:          32 bytes (Ed25519 identity private key)
    device_list:      SignedDeviceList
    contacts:         [
        {
            pgp_fingerprint: 20 bytes
            ik_pub:          32 bytes
            verified:        bool
            display_name:    UTF-8 string
        },
        ...
    ]
    created_at:       uint64
}
```

The vault is encrypted:

```
vault_nonce = random(24)
encrypted_vault = XChaCha20_Poly1305_Encrypt(
    key:       vault_key,
    nonce:     vault_nonce,
    aad:       "E2EEMessenger_Vault_v1",
    plaintext: Serialize(VaultPayload)
)
```

The encrypted vault (along with `salt` and `vault_nonce`) is stored on the relay server or a user-chosen cloud storage provider. The relay/cloud cannot decrypt it without the recovery code.

### 12.5 Recovery Flow

```
1. User installs the application on a new device.
2. User selects "Recover account."
3. User enters their recovery code (mnemonic or hex).
4. The application fetches the encrypted vault from the relay/cloud.
5. The application derives the vault key using Argon2id with the stored salt.
6. The application decrypts the vault.
7. The application imports the PGP key and Ed25519 identity key.
8. The application generates new pre-key material (SPK, OPKs) for the new device.
9. The application creates a new device attestation signed by the PGP key.
10. The application publishes the new device's pre-key bundle.
11. Peers must re-establish sessions with the recovered device (existing ratchet state is lost).
```

**Important:** Session ratchet state is **not** included in the vault. After recovery, all active sessions must be re-established via X3DH. This is by design: including ratchet state would compromise forward secrecy guarantees if the vault were compromised.

---

## 13. Local Storage Security

### 13.1 Encrypted Vault (At Rest)

All sensitive data stored on the local device is encrypted in an application-level vault:

```
Local Vault Contents:
    - Ed25519 identity key pair (IK)
    - All pre-key private keys (SPK, OPKs)
    - All active ratchet session states
    - Skipped message keys (MKSKIPPED)
    - Contact list and verification status
    - Message history (optional, configurable)
    - Recovery vault salt (for re-encryption)
```

The local vault is encrypted using a **local vault key** derived from one of the following unlock mechanisms.

### 13.2 WebAuthn-Gated Access

The preferred unlock mechanism uses WebAuthn (FIDO2) to gate access to the local vault:

**Setup:**

1. The application generates a `local_vault_key` (32 bytes from CSPRNG).
2. A WebAuthn credential is created (platform authenticator preferred, e.g., fingerprint sensor, Face ID, Windows Hello).
3. The `local_vault_key` is encrypted with a key derived from the WebAuthn PRF extension output:

```
webauthn_salt = random(32)
prf_output = WebAuthn_PRF(credential_id, webauthn_salt)  # PRF extension (hmac-secret)
wrapping_key = BLAKE2b-256(key=prf_output, input="E2EEMessenger_LocalVault")
encrypted_local_vault_key = XChaCha20_Poly1305_Encrypt(
    key:       wrapping_key,
    nonce:     random(24),
    aad:       "E2EEMessenger_LocalKeyWrap",
    plaintext: local_vault_key
)
```

**Unlock:**

1. The application prompts for WebAuthn authentication.
2. The PRF extension returns the deterministic `prf_output` for the same `webauthn_salt`.
3. The `wrapping_key` is re-derived and used to decrypt `encrypted_local_vault_key`.
4. The `local_vault_key` is used to decrypt the local vault.

If the WebAuthn PRF extension is not available (older authenticators), a fallback scheme is used:

### 13.3 Passphrase Fallback

If WebAuthn is unavailable, the local vault is protected by a user-chosen passphrase:

```
passphrase_salt = random(32)
local_vault_key = Argon2id(
    password:  UTF8_Encode(passphrase),
    salt:      passphrase_salt,
    time:      3 iterations,
    memory:    256 MiB,
    threads:   4,
    output:    32 bytes
)
```

The vault is then encrypted with `local_vault_key` using XChaCha20-Poly1305 as described above.

### 13.4 Vault Encryption

Regardless of the unlock mechanism, the local vault is encrypted as:

```
vault_nonce = random(24)
encrypted_local_vault = XChaCha20_Poly1305_Encrypt(
    key:       local_vault_key,
    nonce:     vault_nonce,
    aad:       "E2EEMessenger_LocalVault_v1",
    plaintext: Serialize(LocalVaultContents)
)
```

Stored on disk:

```
LocalVaultFile := {
    version:           uint8 = 0x01
    unlock_method:     uint8 (0x01 = WebAuthn, 0x02 = Passphrase)
    vault_nonce:       24 bytes
    encrypted_vault:   variable length
    # Method-specific fields:
    # If WebAuthn:
    webauthn_salt:         32 bytes
    credential_id:         variable length
    encrypted_vault_key:   variable length (wrapped local_vault_key)
    key_wrap_nonce:        24 bytes
    # If Passphrase:
    passphrase_salt:       32 bytes
    argon2_params:         { time: uint32, memory: uint32, threads: uint8 }
}
```

### 13.5 Memory Protection

Implementations should take best-effort measures to protect sensitive key material in memory:

- Use `mlock()` / `VirtualLock()` on memory pages containing key material to prevent swapping to disk.
- Zero key material immediately after use using a volatile or compiler-barrier-protected memset.
- Minimize the window during which decrypted vault contents reside in memory.
- On mobile platforms, lock the vault when the application is backgrounded.

### 13.6 Secure Deletion

When key material is deleted (e.g., consumed OPKs, old SPKs past the grace period, expired skipped message keys):

1. The key bytes are overwritten with zeros.
2. The vault is re-encrypted and re-written to disk.
3. On platforms supporting it, `fsync()` is called to ensure the overwrite is flushed to persistent storage.

Note that secure deletion on flash storage (SSDs, eMMC) is inherently limited due to wear leveling. Full-disk encryption at the OS level is strongly recommended as a complementary measure.

---

## Appendix A: Notation

| Symbol | Meaning |
|---|---|
| `\|\|` | Byte string concatenation |
| `X25519(sk, pk)` | X25519 Diffie-Hellman: scalar multiplication of private key `sk` with public key `pk` |
| `Ed25519_Sign(sk, m)` | Ed25519 signature of message `m` with private key `sk` |
| `Ed25519_Verify(pk, m, sig)` | Verify Ed25519 signature `sig` over message `m` with public key `pk` |
| `BLAKE2b-N(...)` | BLAKE2b with N-bit output |
| `BLAKE2b(key=k, input=m, len=n)` | Keyed BLAKE2b with key `k`, input `m`, output length `n` bytes |
| `XChaCha20_Poly1305_Encrypt(key, nonce, aad, plaintext)` | AEAD encryption |
| `XChaCha20_Poly1305_Decrypt(key, nonce, aad, ciphertext)` | AEAD decryption (includes tag verification) |
| `PGP_Sign(sk, m)` | OpenPGP signature of message `m` with PGP private key `sk` |
| `random(n)` | `n` bytes from a cryptographically secure pseudorandom number generator |
| `CSPRNG` | Cryptographically Secure Pseudorandom Number Generator |

## Appendix B: Constants

| Constant | Value | Description |
|---|---|---|
| `MAX_SKIP` | 1000 | Maximum number of skipped message keys to compute |
| `MAX_SKIPPED_KEY_AGE` | 30 days | Maximum time to retain skipped message keys |
| `MAX_SKIPPED_KEYS` | 2000 | Maximum total skipped message keys to store |
| `SPK_ROTATION_INTERVAL` | 7 days | Signed pre-key rotation period |
| `SPK_GRACE_PERIOD` | 14 days | Retention period for old signed pre-keys |
| `INITIAL_OPK_COUNT` | 100 | Initial number of one-time pre-keys |
| `OPK_REPLENISH_THRESHOLD` | 25 | Replenish OPKs when count drops below this |
| `OPK_REPLENISH_BATCH` | 75 | Number of OPKs to generate during replenishment |
| `MAX_OPK_COUNT` | 200 | Maximum stored one-time pre-keys |
| `RELAY_MESSAGE_TTL` | 30 days | Maximum time a relay stores an undelivered message |
| `PADDING_BLOCK_SIZE` | 256 bytes | Plaintext padding granularity |
| `ARGON2_TIME` | 3 | Argon2id iteration count |
| `ARGON2_MEMORY` | 262144 KiB (256 MiB) | Argon2id memory parameter |
| `ARGON2_THREADS` | 4 | Argon2id parallelism |

## Appendix C: Security Considerations

### C.1 Threat Model

The protocol assumes:

- **Trusted:** The local device hardware and OS are not compromised during active use.
- **Untrusted:** All network infrastructure, including relay servers, signaling servers, and ISPs.
- **Partially trusted:** The user's PGP key management practices (the protocol cannot compensate for a compromised PGP private key beyond revocation).

### C.2 Known Limitations

1. **Metadata:** While message contents are protected, communication patterns (who communicates with whom and when) may be observable by relay servers and network observers. Users requiring metadata protection should use the protocol over an anonymizing transport (e.g., Tor).

2. **Ratchet state compromise:** If an attacker obtains a device's current ratchet state, they can decrypt messages in the current chain until a DH ratchet step occurs. The DH ratchet provides post-compromise security: once a new DH exchange completes, the attacker is locked out again.

3. **Denial of service:** An attacker who can intercept and drop messages can prevent communication. The protocol does not provide availability guarantees.

4. **Replay attacks:** The AEAD construction and monotonically increasing message numbers prevent replay within a session. Cross-session replay is prevented by the unique session key derived from X3DH.

5. **Quantum computing:** The X25519 and Ed25519 primitives are not quantum-resistant. A future revision of this protocol should incorporate a post-quantum KEM (e.g., ML-KEM / Kyber) in a hybrid key agreement alongside X25519, following the approach of Signal's PQXDH.

### C.3 Implementation Guidance

- Use well-audited cryptographic libraries (e.g., libsodium, ring, OpenPGP.js).
- Never implement cryptographic primitives from scratch.
- All comparison of secret values must be constant-time.
- CSPRNG seeding must use OS-provided entropy sources (`/dev/urandom`, `getentropy()`, `CryptGenRandom`, `crypto.getRandomValues()`).
- Protocol version negotiation should be implemented to allow future upgrades without breaking backward compatibility.

---

## Appendix D: References

1. Marlinspike, M., & Perrin, T. (2016). *The X3DH Key Agreement Protocol*. Signal Foundation. https://signal.org/docs/specifications/x3dh/
2. Perrin, T., & Marlinspike, M. (2016). *The Double Ratchet Algorithm*. Signal Foundation. https://signal.org/docs/specifications/doubleratchet/
3. Cohn-Gordon, K., Cremers, C., Dowling, B., Garratt, L., & Stebila, D. (2020). *A Formal Security Analysis of the Signal Messaging Protocol*. Journal of Cryptology, 33(4), 1914-1983.
4. Aumasson, J.-P., Neves, S., Wilcox-O'Hearn, Z., & Winnerlein, C. (2013). *BLAKE2: simpler, smaller, fast as MD5*. ACNS 2013.
5. Bernstein, D. J. (2008). *ChaCha, a variant of Salsa20*. https://cr.yp.to/chacha.html
6. RFC 7748: Elliptic Curves for Security (Langley, A., Hamburg, M., & Turner, S., 2016).
7. RFC 8032: Edwards-Curve Digital Signature Algorithm (Ed25519 and Ed448) (Josefsson, S., & Liusvaara, I., 2017).
8. RFC 4880: OpenPGP Message Format (Callas, J., Donnerhacke, L., Finney, H., Shaw, D., & Thayer, R., 2007).
9. Biryukov, A., Dinu, D., & Khovratovich, D. (2016). *Argon2: the memory-hard function for password hashing and other applications*. https://www.rfc-editor.org/rfc/rfc9106
10. W3C Web Authentication (WebAuthn) Level 2. https://www.w3.org/TR/webauthn-2/
