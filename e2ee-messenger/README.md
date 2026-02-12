# E2EE Messenger

End-to-end encrypted peer-to-peer messaging platform with PGP identity anchoring.

## Architecture

```
e2ee-messenger/
├── apps/
│   ├── web/          # Next.js web application (PWA)
│   └── server/       # Rendezvous + relay server (Express)
├── packages/
│   └── crypto/       # Cryptographic primitives and protocols
├── docs/             # Protocol spec, threat model, API docs
└── scripts/          # Demo and tooling scripts
```

## Stack Choice: Web App (Option A)

Chosen for:
- **Broad reach**: Works on any device with a modern browser
- **WebAuthn**: Native passkey/biometric support in browsers
- **WebRTC**: P2P DataChannels for direct messaging
- **PWA**: Installable, offline-capable
- **Speed**: Fastest to prototype and iterate

Stack:
- **Frontend**: Next.js 14, TypeScript, Tailwind CSS
- **Crypto**: libsodium-wrappers-sumo (XChaCha20-Poly1305, Ed25519, X25519, BLAKE2b), OpenPGP.js
- **Auth**: WebAuthn (platform authenticators / passkeys)
- **Transport**: WebRTC DataChannels (P2P), WebSocket (relay fallback)
- **Server**: Express + SQLite (minimal, zero-trust)

## Security Design

### What PGP Does (and Does NOT Do)

PGP is used **only** as an identity anchor:
- Parse and validate imported PGP private keys
- Extract fingerprints for identity
- Sign attestation statements binding messaging keys to PGP identity

PGP is **not** used for message encryption. Messages use modern E2EE:
- **X3DH** (Extended Triple Diffie-Hellman) for key agreement
- **Double Ratchet** for message encryption with forward secrecy
- **XChaCha20-Poly1305** for AEAD

### Security Properties

| Property | Achieved | Mechanism |
|----------|----------|-----------|
| End-to-end encryption | ✓ | Double Ratchet + AEAD |
| Forward secrecy | ✓ | DH ratchet, ephemeral keys |
| Post-compromise security | ✓ | DH ratchet heals |
| Replay protection | ✓ | Message numbers, one-time keys |
| Message authentication | ✓ | AEAD (Poly1305 tag) |
| Identity binding | ✓ | PGP attestation signatures |
| Local data protection | ✓ | Encrypted vault, WebAuthn gate |
| Deniability | ✓ | X3DH provides deniability |
| Metadata protection | Partial | Server sees who talks to whom |

### What Remains Exposed

- Traffic analysis metadata (requires Tor/mixnet)
- IP addresses visible to server
- Message sizes and timing
- PGP fingerprints (public identifiers by design)

See [docs/threat-model.md](docs/threat-model.md) for full analysis.

## Quick Start

### Prerequisites

- Node.js >= 20.0.0
- npm >= 9.0.0

### Install and Run

```bash
cd e2ee-messenger
npm install
npm run dev
```

This starts:
- **Server**: http://localhost:3001
- **Web UI**: http://localhost:3000

### Run Tests

```bash
npm test
```

### Run Demo

```bash
npm run demo
```

The demo script simulates two clients (Alice & Bob) performing the full E2EE flow:
1. PGP key generation and import
2. Messaging identity key generation
3. Attestation signing and publishing
4. X3DH key agreement
5. Double Ratchet session establishment
6. Encrypted message exchange via relay

## Project Structure

### packages/crypto

Core cryptographic library:
- `pgp-identity.ts` - PGP key import, attestation signing/verification
- `key-bundle.ts` - Ed25519/X25519 key management, pre-key generation
- `x3dh.ts` - Extended Triple Diffie-Hellman key agreement
- `double-ratchet.ts` - Double Ratchet algorithm with XChaCha20-Poly1305
- `local-vault.ts` - Encrypted local storage
- `safety-number.ts` - Safety Number computation for contact verification
- `recovery.ts` - Recovery code generation and validation

### apps/server

Minimal zero-trust server:
- **Rendezvous**: Publish/lookup identity attestations and pre-keys
- **Relay**: Store-and-forward encrypted message blobs
- **Signaling**: WebRTC signaling message relay
- **WebSocket**: Real-time signaling and relay notifications

### apps/web

Next.js web application:
- Setup wizard (4-step: import PGP, create passkey, generate identity, save recovery code)
- Lock screen with passkey authentication
- Chat interface with E2EE indicators
- Contact management with verification states
- Device management with revocation
- Dark/light mode

## Documentation

- [Protocol Specification](docs/protocol.md) - Detailed protocol design
- [Threat Model](docs/threat-model.md) - Security analysis
- [API Specification](docs/api.md) - Server REST/WebSocket API
- [Operations Guide](docs/ops.md) - Deployment and configuration
- [User Guide](docs/user-guide.md) - End-user documentation

## Security Checklist for Production

- [ ] TLS everywhere (HTTPS, WSS)
- [ ] Hardware security keys for WebAuthn
- [ ] SQLCipher for encrypted server database
- [ ] Tor hidden service for metadata resistance
- [ ] Key transparency log
- [ ] Formal protocol verification
- [ ] Independent security audit
- [ ] Memory protection for key material
- [ ] Constant-time operations audit
- [ ] Reproducible builds
- [ ] Dependency pinning and auditing
- [ ] CSP headers and XSS protection
- [ ] Rate limiting tuning

## Future Work

- Desktop app via Electron with OS keychain integration
- Group messaging (Sender Keys or MLS)
- Disappearing messages
- File/media transfer (encrypted)
- Push notifications (encrypted)
- Key transparency log
- Tor transport integration
- Formal verification of protocol state machine
- Mobile apps (React Native)
