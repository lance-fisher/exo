# LLM Enclave Security Guide

## Threat Model

The LLM Enclave protects against:
1. **Data exfiltration** - Model or prompts sending data to external servers
2. **Unauthorized access** - External processes reading enclave data
3. **Tampering** - Modified scripts or model weights
4. **Crash dump leakage** - Windows Error Reporting capturing sensitive memory

## Security Layers

### Layer 1: Network Isolation (Firewall)
- Ollama is blocked from all outbound internet traffic
- DNS queries (port 53 UDP/TCP) are explicitly blocked to prevent DNS exfiltration
- Node.js (OpenClaw) is blocked except localhost connections
- All traffic is bound to `127.0.0.1` only

Verify firewall rules:
```powershell
Get-NetFirewallRule -DisplayName "Block Ollama*" | Format-Table DisplayName, Enabled, Action
Get-NetFirewallRule -DisplayName "LLM_Enclave:*" | Format-Table DisplayName, Enabled, Action
```

### Layer 2: Script Integrity Verification
SHA256 hashes of all `.ps1` and `.py` files are computed at setup and verified at every launch.

Establish baseline:
```powershell
.\scripts\13_verify_script_integrity.ps1
```

Verify integrity:
```powershell
.\scripts\13_verify_script_integrity.ps1 -Verify
```

### Layer 3: Model Digest Verification
The Ollama model digest is recorded at first launch and verified on subsequent launches.
If the digest changes (model tampered with), launch is blocked.

Stored at: `runtime/config/model_digests.json`

### Layer 4: Fail-Closed Launch
`LAUNCH.ps1` runs security preflight checks before starting any services:
1. Firewall rules active
2. Ollama bound to localhost
3. Bridge directories exist
4. Script integrity matches baseline

If any check fails, Ollama does **not** start. Override with `-SkipSecurityChecks` (not recommended).

### Layer 5: Bridge Security
File operations are scoped to `workspace_bridge/`:
- **Inbox**: Files imported for AI to read
- **Outbox**: Files AI produces
- **Scratch**: Temporary workspace

Path traversal is prevented via `relative_to()` checks in Python.
The apply script (`05_apply_changes.ps1`) requires typed "CONFIRM APPLY" before any project files are touched.

### Layer 6: WER Crash Dump Prevention
Windows Error Reporting is disabled for `ollama.exe` and `python.exe` via registry keys.
This prevents memory dumps containing prompts/responses from being written to disk.

## Optional Hardening

### Pagefile Encryption
Windows may page LLM data (prompts, responses) to the pagefile. To mitigate:

```powershell
# Enable pagefile encryption (requires Windows Pro/Enterprise, reboot required)
fsutil behavior set encryptpagingfile 1
```

Or clear pagefile on shutdown (slower):
```powershell
Set-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Memory Management" `
    -Name "ClearPageFileAtShutdown" -Value 1 -Type DWord
```

### PowerShell Script Signing
For maximum security, sign all `.ps1` scripts with a code signing certificate:

```powershell
# Create self-signed cert (one-time)
$cert = New-SelfSignedCertificate -Type CodeSigningCert -Subject "CN=LLM Enclave" `
    -CertStoreLocation Cert:\CurrentUser\My

# Sign scripts
Get-ChildItem *.ps1 -Recurse | ForEach-Object {
    Set-AuthenticodeSignature -FilePath $_.FullName -Certificate $cert
}

# Set execution policy
Set-ExecutionPolicy AllSigned -Scope CurrentUser
```

Note: The enclave uses SHA256 hash verification (Layer 2) as the primary tamper detection mechanism.
Script signing provides an additional layer but requires certificate management.

### Process Isolation (LLM_Enclave_User)
The provisioning script can create a restricted Windows user (`LLM_Enclave_User`) via `-CreateRestrictedUser`.
This is a future enhancement — currently, script-level enforcement is the primary security mechanism.
Full RunAs integration would require credential management and interactive session support.
