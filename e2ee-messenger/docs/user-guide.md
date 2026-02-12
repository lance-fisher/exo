# User Guide

## What is E2EE Messenger?

E2EE Messenger is an end-to-end encrypted peer-to-peer messaging application. Your messages are encrypted on your device before they leave, and only the intended recipient can decrypt them. No server — not even ours — can read your messages.

## Getting Started

### Step 1: Import Your PGP Key

Your PGP key is your identity anchor. You'll need an existing OpenPGP private key (ASCII-armored format).

If you don't have one, generate one with:
```bash
gpg --full-generate-key
gpg --armor --export-secret-keys your@email.com > my-key.asc
```

In the setup wizard:
1. Paste your ASCII-armored private key or upload the `.asc` file
2. Enter your key passphrase if it's passphrase-protected
3. Click "Import Key"

Your PGP key will be encrypted and stored locally. **It is never uploaded.**

### Step 2: Create a Passkey

A passkey protects your local data. Depending on your device, this uses:
- Touch ID / Face ID (macOS, iOS)
- Windows Hello (Windows)
- Fingerprint reader (Android, Linux)
- Device PIN as fallback

You'll use this passkey every time you open the app.

### Step 3: Generate Messaging Identity

A separate key pair is generated specifically for messaging (Ed25519). Your PGP key signs an attestation binding this new key to your identity. This attestation is published to the rendezvous server so others can find you.

### Step 4: Save Your Recovery Code

A recovery code is displayed. **Write it down and store it offline.**

If you lose all your devices, you'll need:
1. Your PGP private key
2. Your recovery code

There is no other way to recover your account. This is by design — no backdoor exists.

## Adding Contacts

### By PGP Fingerprint

1. Go to Contacts tab
2. Click "Add Contact"
3. Enter their display name and 40-character PGP fingerprint
4. Click "Add Contact"

Contacts added this way are marked as **Unverified** until you verify in person.

### By QR Code (Recommended)

1. Meet in person
2. Have your contact show their QR code
3. Scan it with your camera

QR verification marks the contact as **Verified** because you've confirmed their identity in person.

## Verification States

| State | Meaning |
|-------|---------|
| **Verified** (green shield) | Identity confirmed via QR scan or out-of-band comparison |
| **Unverified** (yellow shield) | Identity fetched from server only — could be MITM |

### Safety Numbers

Each conversation has a unique Safety Number derived from both parties' identity keys. To verify:

1. Open the contact's detail panel
2. Compare the Safety Number with your contact (in person, phone call, etc.)
3. If numbers match, click "Mark as Verified"

**If Safety Numbers ever change,** it means one party's identity key changed. This could indicate a new device or a potential attack. Re-verify.

## Sending Messages

1. Select a contact from the sidebar
2. Type your message
3. Press Enter or click Send
4. Authenticate with your passkey/biometric (step-up auth)

Every message is encrypted with forward secrecy before leaving your device.

## Connection States

| State | Meaning |
|-------|---------|
| **P2P Connected** (blue) | Direct peer-to-peer connection via WebRTC |
| **Connecting** (yellow) | Attempting to establish P2P connection |
| **Relay Mode** (gray) | Using encrypted relay server (P2P unavailable) |

P2P is preferred for lower latency and less metadata exposure. Relay mode stores encrypted messages on the server until the recipient fetches them.

## Device Management

### Multiple Devices

Each device has its own key pair. To add a new device:
1. Log in on the new device
2. Authorize it from an existing device via QR code or signed token

### Revoking a Device

If a device is lost or compromised:
1. Go to Devices tab
2. Click the revoke button next to the device
3. A signed revocation is published

The revoked device can no longer decrypt new messages.

## Security Features

- **End-to-End Encryption**: XChaCha20-Poly1305 with Double Ratchet
- **Forward Secrecy**: Past messages can't be decrypted if keys are compromised
- **Post-Compromise Security**: New DH ratchet steps heal after a compromise
- **Replay Protection**: Each message key is used exactly once
- **Local Encryption**: All keys encrypted at rest with passkey-derived key
- **Step-Up Auth**: Biometric verification before each message send (configurable)

## Locking the App

Click the lock icon in the sidebar to lock the app immediately. You'll need to re-authenticate with your passkey to unlock.

The app locks automatically when you close the tab.

## Wiping Data

On the lock screen, click "Wipe all local data" to permanently delete all local data including keys, messages, and contacts. This cannot be undone.

## Dark Mode

Toggle dark/light mode with the sun/moon icon in the sidebar.

## What We Cannot Protect Against

- **Traffic analysis**: An attacker watching network traffic can see when you're communicating and approximate message sizes. Use Tor for stronger metadata protection.
- **Compromised device**: If your device is actively compromised with malware, the attacker may be able to read messages as you decrypt them.
- **Screen capture**: Messages are decrypted for display. Screen recording or shoulder surfing can expose content.
- **Lost recovery code + lost devices**: Your account is unrecoverable by design.
