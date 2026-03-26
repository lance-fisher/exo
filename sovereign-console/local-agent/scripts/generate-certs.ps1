#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Generate mutual TLS certificates for the Sovereign Console Local Agent.

.DESCRIPTION
    This script generates:
    1. A self-signed CA certificate (used to validate the agent on the broker side)
    2. An agent client certificate signed by the CA
    3. Exports everything in PEM format for use by the agent

.NOTES
    Run from the local-agent directory:
      powershell -ExecutionPolicy Bypass -File scripts\generate-certs.ps1

    After running, upload the CA certificate (certs/ca.pem) to your broker
    so it can verify agent connections.
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# ── Configuration ────────────────────────────────────────────────────────────

$AgentDir  = Split-Path -Parent $PSScriptRoot
$CertsDir  = Join-Path $AgentDir "certs"
$CaKeyFile = Join-Path $CertsDir "ca-key.pem"
$CaCertFile = Join-Path $CertsDir "ca.pem"
$AgentKeyFile = Join-Path $CertsDir "agent-key.pem"
$AgentCertFile = Join-Path $CertsDir "agent.pem"
$AgentCsrFile = Join-Path $CertsDir "agent.csr"
$CaDays = 3650       # CA valid for 10 years
$AgentDays = 365     # Agent cert valid for 1 year
$KeySize = 4096
$CaSubject = "/C=US/ST=State/O=Sovereign Console/CN=Sovereign Console CA"
$AgentSubject = "/C=US/ST=State/O=Sovereign Console/CN=Sovereign Console Agent"

Write-Host "=============================================" -ForegroundColor Cyan
Write-Host " Sovereign Console — mTLS Certificate Generator" -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host ""

# ── Check for OpenSSL ────────────────────────────────────────────────────────

$openssl = $null
$candidates = @(
    "openssl",
    "C:\Program Files\Git\usr\bin\openssl.exe",
    "C:\Program Files\OpenSSL-Win64\bin\openssl.exe",
    "C:\Program Files (x86)\OpenSSL-Win32\bin\openssl.exe"
)

foreach ($candidate in $candidates) {
    try {
        $null = & $candidate version 2>&1
        $openssl = $candidate
        break
    } catch {
        continue
    }
}

if (-not $openssl) {
    Write-Error @"
OpenSSL not found. Install one of:
  - Git for Windows (includes OpenSSL): https://git-scm.com/download/win
  - OpenSSL for Windows: https://slproweb.com/products/Win32OpenSSL.html
  - Or add OpenSSL to your PATH
"@
    exit 1
}

Write-Host "[OK] Found OpenSSL: $openssl" -ForegroundColor Green
& $openssl version

# ── Create certs directory ───────────────────────────────────────────────────

if (-not (Test-Path $CertsDir)) {
    New-Item -ItemType Directory -Path $CertsDir -Force | Out-Null
}

# ── Check for existing certs ────────────────────────────────────────────────

if ((Test-Path $CaCertFile) -or (Test-Path $AgentCertFile)) {
    Write-Host ""
    Write-Host "[WARN] Existing certificates found in $CertsDir" -ForegroundColor Yellow
    $response = Read-Host "Overwrite existing certificates? (y/N)"
    if ($response -ne "y" -and $response -ne "Y") {
        Write-Host "Aborted. Existing certificates preserved." -ForegroundColor Yellow
        exit 0
    }
}

# ── 1. Generate CA Private Key ──────────────────────────────────────────────

Write-Host ""
Write-Host "Generating CA private key ($KeySize-bit RSA)..." -ForegroundColor Yellow

& $openssl genrsa -out $CaKeyFile $KeySize 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { Write-Error "Failed to generate CA key"; exit 1 }
Write-Host "[OK] CA private key: $CaKeyFile" -ForegroundColor Green

# ── 2. Generate Self-Signed CA Certificate ──────────────────────────────────

Write-Host ""
Write-Host "Generating self-signed CA certificate (valid $CaDays days)..." -ForegroundColor Yellow

& $openssl req -new -x509 -key $CaKeyFile -out $CaCertFile -days $CaDays -subj $CaSubject 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { Write-Error "Failed to generate CA certificate"; exit 1 }
Write-Host "[OK] CA certificate: $CaCertFile" -ForegroundColor Green

# ── 3. Generate Agent Private Key ───────────────────────────────────────────

Write-Host ""
Write-Host "Generating agent private key ($KeySize-bit RSA)..." -ForegroundColor Yellow

& $openssl genrsa -out $AgentKeyFile $KeySize 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { Write-Error "Failed to generate agent key"; exit 1 }
Write-Host "[OK] Agent private key: $AgentKeyFile" -ForegroundColor Green

# ── 4. Generate Agent CSR ───────────────────────────────────────────────────

Write-Host ""
Write-Host "Generating agent certificate signing request..." -ForegroundColor Yellow

& $openssl req -new -key $AgentKeyFile -out $AgentCsrFile -subj $AgentSubject 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { Write-Error "Failed to generate agent CSR"; exit 1 }
Write-Host "[OK] Agent CSR: $AgentCsrFile" -ForegroundColor Green

# ── 5. Sign Agent Certificate with CA ───────────────────────────────────────

Write-Host ""
Write-Host "Signing agent certificate with CA (valid $AgentDays days)..." -ForegroundColor Yellow

# Create extensions file for client auth
$extFile = Join-Path $CertsDir "agent-ext.cnf"
@"
[v3_req]
basicConstraints = CA:FALSE
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = clientAuth
subjectAltName = @alt_names

[alt_names]
DNS.1 = sovereign-console-agent
"@ | Set-Content -Path $extFile -Encoding ASCII

& $openssl x509 -req `
    -in $AgentCsrFile `
    -CA $CaCertFile `
    -CAkey $CaKeyFile `
    -CAcreateserial `
    -out $AgentCertFile `
    -days $AgentDays `
    -extensions v3_req `
    -extfile $extFile 2>&1 | Out-Null

if ($LASTEXITCODE -ne 0) { Write-Error "Failed to sign agent certificate"; exit 1 }
Write-Host "[OK] Agent certificate: $AgentCertFile" -ForegroundColor Green

# ── 6. Clean Up Temporary Files ─────────────────────────────────────────────

Remove-Item -Path $AgentCsrFile -Force -ErrorAction SilentlyContinue
Remove-Item -Path $extFile -Force -ErrorAction SilentlyContinue
Remove-Item -Path (Join-Path $CertsDir "ca.srl") -Force -ErrorAction SilentlyContinue

# ── 7. Set Restrictive Permissions on Private Keys ──────────────────────────

Write-Host ""
Write-Host "Setting restrictive permissions on private keys..." -ForegroundColor Yellow

foreach ($keyFile in @($CaKeyFile, $AgentKeyFile)) {
    if (Test-Path $keyFile) {
        $acl = Get-Acl $keyFile
        $acl.SetAccessRuleProtection($true, $false)  # Disable inheritance
        $adminRule = New-Object System.Security.AccessControl.FileSystemAccessRule(
            "BUILTIN\Administrators", "FullControl", "Allow"
        )
        $acl.AddAccessRule($adminRule)

        # Allow the service account to read the key
        try {
            $svcRule = New-Object System.Security.AccessControl.FileSystemAccessRule(
                "$env:COMPUTERNAME\SovereignAgent", "Read", "Allow"
            )
            $acl.AddAccessRule($svcRule)
        } catch {
            Write-Host "[WARN] Could not add SovereignAgent permission (account may not exist yet)" -ForegroundColor Yellow
        }

        Set-Acl -Path $keyFile -AclObject $acl
    }
}

Write-Host "[OK] Private key permissions restricted" -ForegroundColor Green

# ── 8. Verify Certificates ──────────────────────────────────────────────────

Write-Host ""
Write-Host "Verifying certificate chain..." -ForegroundColor Yellow

$verifyResult = & $openssl verify -CAfile $CaCertFile $AgentCertFile 2>&1
if ($verifyResult -match "OK") {
    Write-Host "[OK] Certificate chain verified successfully" -ForegroundColor Green
} else {
    Write-Host "[WARN] Certificate verification returned: $verifyResult" -ForegroundColor Yellow
}

# ── 9. Display Certificate Details ──────────────────────────────────────────

Write-Host ""
Write-Host "── CA Certificate ──────────────────────────" -ForegroundColor Cyan
& $openssl x509 -in $CaCertFile -noout -subject -issuer -dates 2>&1 | ForEach-Object { Write-Host "  $_" }

Write-Host ""
Write-Host "── Agent Certificate ───────────────────────" -ForegroundColor Cyan
& $openssl x509 -in $AgentCertFile -noout -subject -issuer -dates 2>&1 | ForEach-Object { Write-Host "  $_" }

# ── Done ─────────────────────────────────────────────────────────────────────

Write-Host ""
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host " Certificate generation complete!"             -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Generated files:" -ForegroundColor White
Write-Host "  CA certificate:    $CaCertFile" -ForegroundColor Gray
Write-Host "  CA private key:    $CaKeyFile" -ForegroundColor Gray
Write-Host "  Agent certificate: $AgentCertFile" -ForegroundColor Gray
Write-Host "  Agent private key: $AgentKeyFile" -ForegroundColor Gray
Write-Host ""
Write-Host "IMPORTANT: Upload the CA certificate ($CaCertFile) to your broker" -ForegroundColor Yellow
Write-Host "so it can verify this agent's mTLS connection." -ForegroundColor Yellow
Write-Host ""
Write-Host "The agent cert expires in $AgentDays days. Set a reminder to rotate it." -ForegroundColor Yellow
Write-Host ""
