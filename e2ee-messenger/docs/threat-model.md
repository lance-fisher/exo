# Threat Model: E2EE P2P Messaging Platform

> **Protocol Stack:** X3DH key agreement + Double Ratchet encryption, with PGP identity anchoring
> **Architecture:** Peer-to-peer messaging with a rendezvous/relay server for key bundles and offline delivery
> **Last Updated:** 2026-02-12

---

## Table of Contents

1. [System Overview](#system-overview)
2. [Trust Boundaries](#trust-boundaries)
3. [Adversary Models](#adversary-models)
4. [What IS Protected](#what-is-protected)
5. [What is NOT Fully Protected](#what-is-not-fully-protected)
6. [Detailed Attack Surface Analysis](#detailed-attack-surface-analysis)
7. [Cryptographic Primitive Assumptions](#cryptographic-primitive-assumptions)
8. [Security Checklist for Hardening](#security-checklist-for-hardening)
9. [Residual Risk Summary](#residual-risk-summary)
10. [Incident Response Considerations](#incident-response-considerations)

---

## System Overview

```
+----------+        +-------------------+        +----------+
|  Alice   | <----> | Rendezvous/Relay  | <----> |   Bob    |
| (Device) |  TLS   |     Server        |  TLS   | (Device) |
+----------+        +-------------------+        +----------+
     |                      |                          |
  Local Vault          Key Bundles              Local Vault
  (encrypted)         (prekeys, SPKs,          (encrypted)
  WebAuthn-gated       one-time keys)          WebAuthn-gated
     |                      |                          |
  PGP Identity         PGP Fingerprint          PGP Identity
  (anchored)            Directory              (anchored)
```

**Key components:**

| Component | Role | Trust Level |
|-----------|------|-------------|
| Client device | Key generation, encryption/decryption, message composition | Trusted (primary TCB) |
| Local encrypted vault | Persistent storage of keys, messages, identity material | Trusted when device is secure |
| Rendezvous/relay server | Stores prekey bundles, relays encrypted messages for offline delivery | **Untrusted** -- treated as adversarial |
| PGP identity layer | Binds long-term identity to messaging keys via attestations | Trusted anchor (out-of-band verification) |
| Transport (TLS) | Protects against passive network observers for connection metadata | Semi-trusted (defense in depth) |

---

## Trust Boundaries

| Boundary | Description | What Crosses It |
|----------|-------------|-----------------|
| **Device boundary** | Between the user's device and the network | Encrypted ciphertexts, prekey bundles, PGP-signed key material |
| **Vault boundary** | Between encrypted local storage and application runtime | Decrypted private keys, plaintext messages (in memory only) |
| **Server boundary** | Between client and rendezvous/relay server | Encrypted messages, public key bundles, IP addresses, device IDs |
| **Identity boundary** | Between PGP web-of-trust and messaging protocol | PGP attestations binding identity keys to messaging keys |
| **WebAuthn boundary** | Between user presence proof and vault decryption | Authentication assertion that gates access to key material |

---

## Adversary Models

### 1. Passive Network Attacker

**Capabilities:** Can observe all network traffic between clients and server, including TLS metadata (IP addresses, packet sizes, timing, connection frequency). Cannot decrypt TLS-protected content.

| Aspect | Assessment |
|--------|------------|
| **Can learn** | That Alice and Bob both connect to the relay server; approximate message sizes; timing of connections; IP addresses of participants; frequency and duration of communication sessions |
| **Cannot learn** | Message plaintext; which prekey bundles are fetched by whom (if server uses uniform responses); cryptographic key material |
| **Mitigations in place** | TLS 1.3 for transport; E2EE for message content; prekey bundles are public by design |
| **Residual risk** | Traffic analysis can reveal communication patterns; IP addresses reveal approximate location |

### 2. Active Network Attacker (MITM)

**Capabilities:** Can intercept, modify, inject, delay, replay, and drop traffic between any two network participants. Controls network infrastructure (routers, DNS, BGP).

| Aspect | Assessment |
|--------|------------|
| **Can do** | Drop or delay messages (denial of service); attempt to downgrade TLS; inject fake server responses if TLS is compromised; perform DNS hijacking to redirect to malicious server |
| **Cannot do** | Forge E2EE message content (Double Ratchet ciphertexts are authenticated); impersonate a PGP identity without the private key; break X3DH key agreement without compromising long-term or ephemeral keys |
| **Mitigations in place** | Certificate pinning for relay server; AEAD encryption on all messages; PGP signatures on identity key bindings; X3DH provides mutual authentication |
| **Residual risk** | Can perform denial of service; first-contact interception possible if users do not verify PGP fingerprints out-of-band; TLS implementation bugs could expose prekey fetches |

### 3. Malicious Server (Compromised Rendezvous/Relay)

**Capabilities:** Full control over the server. Can read all stored data, modify responses, selectively deliver or withhold messages, serve manipulated prekey bundles, and log all metadata.

This is the adversary model the system is **primarily designed to resist**.

| Aspect | Assessment |
|--------|------------|
| **Can do** | Withhold or delay message delivery (availability attack); log metadata -- IP addresses, PGP fingerprints, device IDs, timestamps, message sizes; serve stale prekey bundles (but not forge them without private keys); perform a prekey exhaustion attack (claim all one-time prekeys are used); correlate sender/receiver timing |
| **Cannot do** | Read message content (E2EE); forge messages from any user (lacks signing keys); forge PGP attestations (lacks PGP private keys); decrypt the local vault on any device; recover plaintext from stored ciphertexts |
| **Critical attack: prekey substitution** | Server could substitute Bob's prekey bundle with attacker-controlled keys. Alice would encrypt to attacker, who decrypts, re-encrypts to Bob. **Mitigation:** Prekey bundles are signed by the identity key, which is attested by PGP. Clients MUST verify the PGP attestation chain before trusting a prekey bundle. Without out-of-band PGP fingerprint verification, this attack succeeds on first contact. |
| **Mitigations in place** | All prekey bundles are signed by identity keys; identity keys are attested by PGP keys; clients verify attestation chain; message content is E2EE; server never sees private keys |
| **Residual risk** | Metadata exposure is comprehensive; availability is at server's discretion; first-contact MITM if PGP fingerprints are not verified out-of-band |

### 4. Compromised Device (Unlocked, Attacker Has Access)

**Capabilities:** Full access to running application, decrypted vault, private keys in memory, plaintext messages, PGP private key (if stored on device), WebAuthn credentials (session is active).

| Aspect | Assessment |
|--------|------------|
| **Can do** | Read all past messages stored on device; read all current key material (identity key, ratchet state, PGP private key); impersonate the user for future messages; export key material for offline use; modify application code (if not integrity-protected) |
| **Cannot do** | Read messages that have been securely deleted from the vault; read messages on the remote peer's device; retroactively decrypt messages if ratchet state has advanced and old keys were deleted (forward secrecy); compromise other users' devices |
| **Mitigations in place** | Forward secrecy means old message keys are deleted after use; secure deletion of ratchet keys after message decryption; WebAuthn session timeouts force re-authentication |
| **Residual risk** | **This is a catastrophic compromise.** All current and future communication is compromised until the user re-establishes identity on a new device. Post-compromise security (DH ratchet) only helps after the attacker loses access AND a new DH ratchet step occurs. |

### 5. Stolen Device (Locked)

**Capabilities:** Physical possession of the device. Cannot unlock the device or authenticate to the application. May attempt brute-force, cold boot attacks, firmware exploits, or chip-off attacks.

| Aspect | Assessment |
|--------|------------|
| **Can do** | Attempt brute-force on device unlock (rate-limited by OS); attempt cold boot attack on RAM (if device was recently running); attempt JTAG/chip-off on storage; analyze device hardware for side channels |
| **Cannot do** | Access encrypted vault without WebAuthn authentication; decrypt any messages without vault key; use PGP private key without vault access; impersonate user without authentication |
| **Mitigations in place** | Encrypted vault requires WebAuthn authentication to unlock; vault encryption key is derived from hardware-backed credential; OS-level full-disk encryption; memory is cleared on lock (best-effort) |
| **Residual risk** | Weak device PIN/password reduces effective security; some platforms do not scrub memory on lock; hardware attacks (cold boot, JTAG) may recover keys from RAM or flash; vault encryption strength depends on the underlying platform's WebAuthn implementation |

### 6. Phishing / Social Engineering

**Capabilities:** Can trick users into revealing credentials, approving malicious WebAuthn prompts, installing malicious software, or accepting unverified PGP fingerprints.

| Aspect | Assessment |
|--------|------------|
| **Can do** | Trick user into accepting a MITM'd first contact (fake PGP fingerprint); trick user into installing a modified client; trick user into revealing recovery codes; trick user into approving WebAuthn authentication on attacker-controlled site (if not origin-bound) |
| **Cannot do** | Break cryptography; forge PGP signatures without key material; bypass WebAuthn origin binding (for hardware keys with proper RP ID verification) |
| **Mitigations in place** | WebAuthn is phishing-resistant by design (origin-bound); PGP fingerprints require explicit out-of-band verification; recovery codes require deliberate user action to reveal |
| **Residual risk** | Users may skip PGP fingerprint verification; users may be tricked into installing a backdoored client; recovery codes can be socially engineered; platform authenticators (biometric) have weaker phishing resistance than roaming hardware keys |

### 7. Metadata Analysis (Traffic Analysis)

**Capabilities:** Long-term observation of network traffic patterns. Can correlate timing, volume, and endpoints across sessions. May have access to multiple vantage points on the network.

| Aspect | Assessment |
|--------|------------|
| **Can learn** | Communication graph (who talks to whom, inferred from server connection timing); message frequency and approximate sizes; online/offline patterns; geographic location from IP addresses; social graph structure and community detection; behavioral fingerprinting (typing speed inferred from message timing) |
| **Cannot learn** | Message content; exact message boundaries (if padding is used); key material |
| **Mitigations in place** | TLS encrypts content on the wire; (optional) message padding to uniform sizes |
| **Residual risk** | **This is the weakest area of the system.** Without Tor or a mixnet, the server and any network observer can build a comprehensive social graph. Timing correlation is extremely difficult to defeat. Even with Tor, a global passive adversary can perform end-to-end timing correlation. |

---

## What IS Protected

### Message Content Confidentiality

| Property | Mechanism | Strength |
|----------|-----------|----------|
| Encryption in transit | Double Ratchet (AES-256-GCM or ChaCha20-Poly1305) | Strong -- each message encrypted with unique key |
| Forward secrecy | DH ratchet generates new key pairs per exchange | Strong -- compromise of current keys does not expose past messages (assuming old keys are securely deleted) |
| Post-compromise security | DH ratchet step introduces fresh entropy | Strong -- after attacker loses access and a DH ratchet step occurs, new messages are again secure |
| Encryption at rest | Encrypted local vault | Moderate -- depends on vault implementation, platform, and WebAuthn authenticator strength |

### Message Integrity and Authentication

| Property | Mechanism | Strength |
|----------|-----------|----------|
| Per-message authentication | AEAD (authenticated encryption with associated data) | Strong -- any modification is detected and message is rejected |
| Sender authentication | X3DH mutual authentication + identity key binding | Strong -- messages are cryptographically bound to sender identity |
| Replay protection | Message numbers within ratchet chain; one-time prekeys consumed on use | Strong -- duplicate message numbers are rejected; prekey reuse is detectable |

### Identity Binding

| Property | Mechanism | Strength |
|----------|-----------|----------|
| Long-term identity | PGP key pair | Strong -- well-understood, auditable, user-controlled |
| Messaging-to-identity binding | PGP attestation signing messaging identity key | Strong -- verifiable by any party with PGP public key |
| Out-of-band verification | PGP fingerprint comparison | Strong when performed -- but relies on user diligence |
| Cross-device identity | PGP key is the root of trust | Strong -- identity survives device changes |

### Forward Secrecy

The Double Ratchet provides forward secrecy at two levels:

1. **Symmetric ratchet (chain keys):** Each message key is derived from the previous chain key via a KDF. After derivation, the old chain key is deleted. Compromise of a message key does not reveal past or future message keys in the same chain.

2. **DH ratchet (asymmetric):** Each exchange of messages triggers a new Diffie-Hellman key exchange with fresh ephemeral keys. This provides a hard cryptographic boundary -- even if the entire current ratchet state is compromised, past messages encrypted under previous DH outputs remain secure (assuming those keys were deleted).

### Post-Compromise Security

After a device compromise, the DH ratchet "heals" the session:

1. Attacker compromises ratchet state at time T.
2. User regains control of device and sends/receives a message, triggering a DH ratchet step with fresh ephemeral keys.
3. Attacker no longer has the new DH private key, so new messages are secure.

**Caveat:** This only works if the attacker does not maintain persistent access. If the attacker has installed a backdoor or retains access to the device, post-compromise security does not help.

### Replay Protection

| Mechanism | What It Prevents |
|-----------|-----------------|
| Message numbers (counters per chain) | Re-delivery of previously seen messages |
| One-time prekeys (consumed on first use) | Replay of initial X3DH key agreement messages |
| DH ratchet advancement | Replay of messages from previous ratchet epochs |
| AEAD nonce binding | Nonce reuse detection within a ratchet chain |

### Local Data at Rest

| Layer | Mechanism |
|-------|-----------|
| OS-level | Full-disk encryption (platform-dependent) |
| Application-level | Encrypted vault using key derived from WebAuthn credential |
| Access control | WebAuthn authentication required to unlock vault |
| Key hierarchy | Vault master key -> per-conversation keys -> per-message keys |

---

## What is NOT Fully Protected

### Metadata and Traffic Analysis

**Severity: HIGH -- This is the most significant limitation of the system.**

| Metadata Exposed | To Whom | Mitigation |
|-----------------|---------|------------|
| IP addresses of all participants | Server, network observers | Use Tor or VPN (not built-in) |
| PGP fingerprints / identity key fingerprints | Server | Fundamental to server's role; cannot be hidden without redesign |
| Device IDs | Server | Required for message routing |
| Timing of all messages (send and receive) | Server, network observers | Decoy traffic / constant-rate padding (not implemented) |
| Approximate message sizes | Network observers (even with TLS) | Padding to fixed sizes (partially implemented) |
| Communication graph (who talks to whom) | Server (definitively), network observers (by correlation) | Mixnet or private information retrieval (not implemented) |
| Online/offline status | Server, network observers | Background keep-alive connections (partial) |
| Frequency of communication per contact | Server | No current mitigation |

**Honest assessment:** A determined adversary with access to the relay server can build a complete social graph of all users. This is a fundamental limitation of the client-server-client relay architecture. True metadata resistance requires architectural changes (mixnet, PIR, or fully decentralized DHT-based routing), each of which introduces significant complexity and latency trade-offs.

### Server-Side Availability Attacks

The server can selectively or completely deny service:

| Attack | Impact | Detection |
|--------|--------|-----------|
| Drop all messages for a user | Complete communication blackout | User notices lack of responses |
| Drop messages selectively | Targeted censorship of specific conversations | Difficult to detect; out-of-band confirmation required |
| Delay messages | Degrades real-time communication | Noticeable but hard to attribute to malice vs. network issues |
| Serve stale prekey bundles | Forces use of last-resort prekey (weaker forward secrecy) | Client can detect if one-time prekeys are never fresh |
| Refuse to accept new prekey uploads | Prevents new session establishment | Client detects upload failures |

**Honest assessment:** Availability is entirely at the server's discretion. There is no cryptographic solution to this in a relay architecture. Mitigation requires server federation or decentralized message routing.

### Account Takeover Vectors

| Attack Vector | Prerequisites | Impact |
|---------------|---------------|--------|
| PGP private key + recovery code | Both compromised (e.g., phishing, backup theft) | **Full account takeover** -- attacker can register new devices, revoke old ones, impersonate user indefinitely |
| PGP private key alone | Key compromised but not recovery code | Can sign new attestations but cannot unlock vault on new device without recovery code; existing sessions continue normally |
| Recovery code alone | Code compromised but not PGP key | Cannot forge attestations; limited impact unless combined with device compromise |
| WebAuthn credential cloning | Platform authenticator vulnerability or export | Access to vault on compromised device; does not propagate to other devices |

### Browser-Based Cryptography Limitations

| Limitation | Description | Severity |
|------------|-------------|----------|
| No memory protection | JavaScript runtime does not support mlock, memory guards, or secure heap allocation | HIGH -- keys may be swapped to disk or remain in memory after deletion |
| No constant-time guarantees | JavaScript JIT compilation means execution time varies based on input; side-channel attacks are feasible | MEDIUM -- timing attacks on crypto operations are theoretically possible |
| Extension/add-on attack surface | Browser extensions can read page DOM, intercept network requests, and access Web Crypto API results | HIGH -- a malicious extension can exfiltrate plaintext messages |
| Garbage collection | Deleted key material may persist in memory until GC runs; no way to force immediate secure erasure | HIGH -- "deleted" keys are still in memory for an indeterminate period |
| Supply chain risk | Application code served from server; compromised server can serve backdoored JavaScript | CRITICAL -- unless code is integrity-verified (e.g., signed, reproducible builds, subresource integrity) |
| WebCrypto API constraints | Limited algorithm support; no access to raw key bytes for some operations | LOW -- workaround via libraries, but adds to code complexity |
| Sandboxing limitations | Browser process isolation is good but not equivalent to hardware TEE | MEDIUM -- OS-level attacks can breach browser sandbox |

**Honest assessment:** Browser-based E2EE is fundamentally weaker than native E2EE. The most critical issue is supply chain risk -- the server that delivers the JavaScript is the same server the system is designed to distrust. Without code signing, reproducible builds, and client-side verification, a compromised server can silently serve a backdoored client. This is the single most important limitation to communicate to users.

---

## Detailed Attack Surface Analysis

### X3DH Key Agreement

| Attack | Description | Mitigation | Residual Risk |
|--------|-------------|------------|---------------|
| Prekey bundle substitution | Server replaces Bob's prekeys with attacker's | PGP-signed identity keys; client verifies attestation chain | First-contact if user skips fingerprint verification |
| One-time prekey exhaustion | Server claims no OTPKs available, forcing fallback | Fallback to signed prekey only; client warns user | Reduced forward secrecy (signed prekey is longer-lived) |
| Prekey replay | Server serves same one-time prekey to multiple initiators | One-time prekey deletion after first use; session ID binding | Server must cooperate for deletion; cannot fully verify server compliance |
| Identity key compromise | Attacker obtains long-term identity private key | PGP attestation revocation; device revocation mechanism | Revocation propagation delay; attacker can race |

### Double Ratchet

| Attack | Description | Mitigation | Residual Risk |
|--------|-------------|------------|---------------|
| Ratchet state theft | Attacker extracts current ratchet state from memory | OS memory protection; vault encryption; minimize key lifetime | Active device compromise defeats all mitigations |
| Message reordering | Attacker reorders delivered ciphertexts | Message counters; out-of-order message buffer with limits | Buffer has finite size; extreme reordering causes message loss |
| Old ciphertext storage | Attacker stores ciphertexts, later compromises keys | Forward secrecy (old chain keys deleted); DH ratchet advancement | If device is compromised before ratchet advances, buffered messages at risk |
| Symmetric chain exhaustion | Attacker forces very long symmetric chain without DH ratchet | DH ratchet triggered on each send/receive direction change | Long one-directional message streams have weaker forward secrecy within the chain |

### PGP Identity Layer

| Attack | Description | Mitigation | Residual Risk |
|--------|-------------|------------|---------------|
| PGP key compromise | Attacker obtains PGP private key | Strong passphrase; hardware-backed PGP key (e.g., YubiKey) | Software-stored PGP keys are vulnerable to device compromise |
| Attestation forgery | Attacker forges PGP attestation for messaging keys | Requires PGP private key; forgery is detectable if key is not compromised | No mitigation if PGP key is compromised |
| Web-of-trust poisoning | Attacker creates fake PGP keys with confusingly similar UIDs | Fingerprint-based verification (not UID-based); TOFU model with continuity checking | Users may be confused by similar UIDs; first-contact TOFU is vulnerable |
| Revocation delay | Attacker uses compromised key before revocation propagates | Short validity periods; push-based revocation; key transparency log | Revocation is inherently asynchronous; race condition is unavoidable |

### Local Storage / Vault

| Attack | Description | Mitigation | Residual Risk |
|--------|-------------|------------|---------------|
| Vault brute-force | Attacker extracts encrypted vault and brute-forces offline | WebAuthn-derived key (not password-derived); hardware authenticator binding | Platform authenticators may use weaker key derivation |
| Cold boot attack | Attacker dumps RAM while device is running/recently locked | OS memory encryption (if available); minimize key lifetime in memory | Many platforms do not encrypt RAM; keys persist after app lock |
| Backup exfiltration | Attacker accesses cloud backup containing vault data | Exclude vault from cloud backup; or encrypt backup with independent key | User may not configure backup exclusion correctly |
| Side-channel on vault operations | Attacker measures timing/power during vault decrypt | Constant-time library for vault KDF | JavaScript cannot guarantee constant-time execution |

---

## Cryptographic Primitive Assumptions

The security of the system depends on the following computational hardness assumptions:

| Primitive | Used For | Assumption | Quantum Threat |
|-----------|----------|------------|----------------|
| X25519 (Curve25519 ECDH) | X3DH key agreement, DH ratchet | Computational Diffie-Hellman (CDH) on Curve25519 | **BROKEN** by Shor's algorithm on a cryptographically relevant quantum computer |
| Ed25519 | Identity key signatures, prekey signatures | Hardness of discrete log on twisted Edwards curve | **BROKEN** by Shor's algorithm |
| AES-256-GCM | Message encryption (AEAD) | AES block cipher security; GCM mode security | Grover's algorithm reduces effective security to ~128-bit; considered safe |
| HKDF-SHA-256 | Key derivation in ratchet | PRF security of HMAC-SHA-256 | Grover reduces to ~128-bit; considered safe |
| SHA-256 | Various hashing | Collision resistance, preimage resistance | Grover reduces to ~128-bit; considered safe |
| RSA-4096 / Ed25519 (PGP) | PGP identity signatures | RSA: integer factorization; Ed25519: discrete log | RSA: **BROKEN** by Shor's; Ed25519: **BROKEN** by Shor's |

**Post-quantum consideration:** The DH-based components (X3DH, Double Ratchet DH steps, PGP signatures) are vulnerable to a future cryptographically relevant quantum computer. A "harvest now, decrypt later" adversary who stores ciphertexts today could decrypt them once quantum computers are available. Migrating to post-quantum key agreement (e.g., ML-KEM / Kyber hybrid) and post-quantum signatures (e.g., ML-DSA / Dilithium) is recommended as a future hardening step.

---

## Security Checklist for Hardening

### Transport Layer

| Measure | Priority | Status | Notes |
|---------|----------|--------|-------|
| Use Tor for all client-server communication | HIGH | Not implemented | Defeats IP-based metadata analysis; adds latency |
| Use Tor onion service for relay server | HIGH | Not implemented | Eliminates server IP exposure; provides server authentication |
| Certificate pinning for relay server | MEDIUM | Recommended | Prevents CA compromise MITM; complicates certificate rotation |
| Padding messages to fixed sizes | MEDIUM | Partial | Defeats message-size traffic analysis; increases bandwidth |
| Decoy traffic generation | LOW | Not implemented | Constant-rate traffic defeats timing analysis; high bandwidth cost |

### Authentication and Identity

| Measure | Priority | Status | Notes |
|---------|----------|--------|-------|
| Hardware security keys for WebAuthn (e.g., YubiKey) | HIGH | Supported | Phishing-resistant; key material never leaves hardware; strongest authenticator option |
| Hardware-backed PGP key (e.g., OpenPGP smartcard) | HIGH | Supported | PGP private key never on general-purpose storage; survives device compromise |
| Key transparency log for identity keys | HIGH | Not implemented | Publicly auditable log of all identity key bindings; detects server-side key substitution |
| Safety number / fingerprint comparison UX | HIGH | Implemented | Users MUST be guided to verify fingerprints on first contact |
| Short authentication string (SAS) verification | MEDIUM | Not implemented | QR code or emoji-based verification; more user-friendly than fingerprint comparison |

### Client Integrity

| Measure | Priority | Status | Notes |
|---------|----------|--------|-------|
| Signed server binaries / reproducible builds | CRITICAL | Not implemented | Without this, the server can serve a backdoored client at any time |
| Subresource integrity (SRI) for all loaded scripts | HIGH | Recommended | Prevents CDN or server compromise from injecting malicious code |
| Client-side code verification (hash pinning) | HIGH | Not implemented | Browser extension or native wrapper verifies code hash before execution |
| Content Security Policy (strict) | MEDIUM | Recommended | Limits code injection surface |
| Native application (Electron/Tauri) with signed updates | MEDIUM | Not implemented | Reduces supply chain risk vs. pure web app; adds update verification |

### Cryptographic Hardening

| Measure | Priority | Status | Notes |
|---------|----------|--------|-------|
| Memory protection for keys (mlock, guard pages) | HIGH | Not possible in browser | Requires native code; prevents keys from being swapped to disk |
| Secure key erasure (explicit memzero) | HIGH | Best-effort in JS | JavaScript GC makes this unreliable; use TypedArrays and overwrite |
| Constant-time operations audit | MEDIUM | Not audited | All comparison and crypto operations must be constant-time to prevent timing side channels |
| Formal verification of protocol state machine | MEDIUM | Not performed | Mechanized proof (e.g., ProVerif, Tamarin) of key exchange and ratchet properties |
| Post-quantum hybrid key agreement | MEDIUM | Not implemented | ML-KEM (Kyber) + X25519 hybrid; protects against harvest-now-decrypt-later |
| Ratchet state backup protection | MEDIUM | Implemented | Ratchet state must never be backed up to cloud storage |

### Operational Security

| Measure | Priority | Status | Notes |
|---------|----------|--------|-------|
| Disappearing messages (configurable TTL) | MEDIUM | Recommended | Limits exposure window for stored plaintext; not enforceable on remote device |
| Screenshot/screen recording protection | LOW | Platform-dependent | FLAG_SECURE on Android; limited options on other platforms |
| Notification content hiding | LOW | Recommended | Prevents lock-screen notification from showing message content |
| Secure delete of vault on remote wipe | MEDIUM | Recommended | Mobile device management or manual remote wipe capability |
| Audit log of security-relevant events | MEDIUM | Recommended | Key changes, new device registrations, verification events |

---

## Residual Risk Summary

The following risks **cannot be fully mitigated** by the current system design and require either architectural changes or acceptance:

| Risk | Severity | Likelihood | Mitigation Path |
|------|----------|------------|-----------------|
| Metadata analysis reveals social graph | HIGH | HIGH (trivial for server) | Mixnet / Tor / PIR -- architectural change |
| Server serves backdoored JavaScript client | CRITICAL | MEDIUM (requires server compromise) | Reproducible builds + client-side verification -- implementation change |
| Browser memory leaks key material | HIGH | MEDIUM (depends on GC behavior) | Native application -- platform change |
| PGP key + recovery code compromise = full takeover | CRITICAL | LOW (requires both factors) | Hardware-backed PGP key; split recovery codes; threshold schemes |
| Quantum computer breaks DH-based key agreement | HIGH | LOW (currently; timeline uncertain) | Post-quantum hybrid migration |
| Device compromise while unlocked | CRITICAL | LOW-MEDIUM (depends on threat model) | Hardware security modules; TEE-based key storage; auto-lock policies |
| Users skip fingerprint verification | HIGH | HIGH (UX friction) | Better verification UX; trust-on-first-use with continuity alerts; key transparency |
| One-time prekey exhaustion by malicious server | MEDIUM | MEDIUM (server is untrusted) | Client-side detection; out-of-band prekey verification; decentralized prekey distribution |

### Risk Matrix

```
                    LOW Impact    MEDIUM Impact    HIGH Impact    CRITICAL Impact
                  +--------------+----------------+--------------+------------------+
HIGH Likelihood   |              | OTP prekey     | Metadata     | JS supply chain  |
                  |              | exhaustion     | analysis;    | (if no code      |
                  |              |                | Skip verify  | signing)         |
                  +--------------+----------------+--------------+------------------+
MEDIUM Likelihood |              |                | Browser      | Device           |
                  |              |                | memory leak; | compromise       |
                  |              |                | Server       | (unlocked)       |
                  |              |                | availability |                  |
                  +--------------+----------------+--------------+------------------+
LOW Likelihood    |              |                | Quantum      | PGP + recovery   |
                  |              |                | threat       | code compromise  |
                  +--------------+----------------+--------------+------------------+
```

---

## Incident Response Considerations

### Compromise Scenarios and Recommended Response

| Scenario | Immediate Actions | Recovery Steps |
|----------|-------------------|----------------|
| **Device compromised (unlocked)** | Revoke device from account; notify contacts of potential compromise; rotate PGP subkeys | Re-establish sessions from a new device; contacts should verify new fingerprints out-of-band |
| **PGP key compromised** | Publish PGP revocation certificate; generate new PGP key; re-attest messaging identity keys | All contacts must re-verify identity through new PGP fingerprint; old attestations are invalid |
| **Recovery code leaked** | Rotate recovery code immediately; audit recent device registrations | If PGP key is also at risk, treat as full account takeover |
| **Server compromised** | Assume all metadata is exposed; assume prekey bundles may have been substituted | All users should re-verify contacts' fingerprints; rotate one-time prekeys; audit key transparency log for unauthorized bindings |
| **Ratchet state leaked (e.g., backup exposure)** | Initiate new session with affected contacts; delete compromised ratchet state | Forward secrecy protects past messages; new DH ratchet step restores security for future messages |

---

## References

- Marlinspike, M. & Perrin, T. (2016). *The X3DH Key Agreement Protocol.* Signal Foundation.
- Perrin, T. & Marlinspike, M. (2016). *The Double Ratchet Algorithm.* Signal Foundation.
- Cohn-Gordon, K., et al. (2017). *A Formal Security Analysis of the Signal Messaging Protocol.* IEEE European Symposium on Security and Privacy.
- RFC 4880 -- OpenPGP Message Format.
- W3C WebAuthn Level 2 Specification.
- Unger, N., et al. (2015). *SoK: Secure Messaging.* IEEE Symposium on Security and Privacy.

---

*This document should be reviewed and updated whenever the protocol, architecture, or threat landscape changes. Security is a process, not a state.*
