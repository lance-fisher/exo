# DELIVERABLE K: OpenClaw Source Verification and Acquisition Plan

## K1. Official OpenClaw Source of Truth

### Identifying the Official Repository

OpenClaw (and its related ecosystem: Open-WebUI, Clawdbot, Moltbot) is sourced from GitHub.

**Verification steps to locate the official repository:**

1. Navigate to https://github.com and search for "OpenClaw".
2. Identify the repository owned by the official organization or maintainer.
3. Cross-reference with any official website, documentation, or known community channels.
4. Confirm the repository has:
   - A consistent commit history (not a recent fork with rewritten history)
   - An established issue tracker and pull request history
   - A LICENSE file
   - A release page with tagged versions

**NOTE:** At the time of this document's creation, "OpenClaw" may refer to multiple projects or may have a different canonical name. The user must verify the exact repository URL before proceeding. This system is built to accept ANY verified repository URL and apply the same security posture.

### Recording the Official Source

Once identified, record the source in:
`D:\ProjectsHome\LLM_Enclave\QWEN35\docs\openclaw_install_record.md`

```
official_repo_url: https://github.com/OWNER/openclaw
verified_by: [Your Name]
verification_date: [Date]
verification_method: [How you confirmed this is the official repo]
```

## K2. Download Latest Release Artifacts with Verification

### Rules for Rejecting Forks or Unverified Binaries

**REJECT if any of the following are true:**
- The repository URL does not match the recorded official source.
- The repository was created recently (within 30 days) and has no substantive history.
- The release artifacts are hosted on a different domain than GitHub releases.
- The release has no Git tag or the tag does not match the release version.
- The release page has no checksums and the maintainer has not published checksums elsewhere.
- The binary file size differs significantly from what is expected.
- The download URL redirects through unknown intermediaries.
- The release was created by a contributor who is not a known maintainer.

### Download and Verification Workflow

```powershell
# =============================================================================
# OPENCLAW DOWNLOAD AND VERIFICATION
# =============================================================================
# This section provides the commands to download and verify OpenClaw.
# The actual download is performed by script 06_download_openclaw.ps1 (H8).
# =============================================================================

# Step 1: Set the official repository URL
$officialRepo = "OWNER/openclaw"  # REPLACE with verified repo
$releaseApiUrl = "https://api.github.com/repos/$officialRepo/releases/latest"

# Step 2: Fetch release metadata (requires temporary network access)
# You must enable outbound temporarily for this step.
$releaseInfo = Invoke-RestMethod -Uri $releaseApiUrl -Headers @{
    "Accept" = "application/vnd.github.v3+json"
    "User-Agent" = "LLM-Enclave-Verifier"
}

# Step 3: Record provenance
$provenance = @{
    repo_url       = "https://github.com/$officialRepo"
    release_tag    = $releaseInfo.tag_name
    release_name   = $releaseInfo.name
    published_at   = $releaseInfo.published_at
    tarball_url    = $releaseInfo.tarball_url
    zipball_url    = $releaseInfo.zipball_url
    commit_sha     = $releaseInfo.target_commitish
    download_date  = (Get-Date -Format "yyyy-MM-dd HH:mm:ss")
    assets         = ($releaseInfo.assets | ForEach-Object { $_.name })
}
$provenance | ConvertTo-Json -Depth 5 | Set-Content `
    -Path "D:\ProjectsHome\LLM_Enclave\QWEN35\openclaw\release\provenance.json"

# Step 4: Download release artifacts
$downloadDir = "D:\ProjectsHome\LLM_Enclave\QWEN35\openclaw\release"
foreach ($asset in $releaseInfo.assets) {
    $outPath = Join-Path $downloadDir $asset.name
    Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $outPath
    Write-Host "Downloaded: $($asset.name)"
}

# Also download source archive for audit
Invoke-WebRequest -Uri $releaseInfo.zipball_url `
    -OutFile (Join-Path $downloadDir "source-$($releaseInfo.tag_name).zip")

# Step 5: Compute SHA256 for every downloaded artifact
$hashFile = "D:\ProjectsHome\LLM_Enclave\QWEN35\hashes\openclaw_hashes.txt"
Get-ChildItem -Path $downloadDir -File | ForEach-Object {
    $hash = (Get-FileHash -Path $_.FullName -Algorithm SHA256).Hash
    "$hash  $($_.Name)  $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" | `
        Add-Content -Path $hashFile
    Write-Host "$($_.Name): $hash"
}

# Step 6: Verify against upstream checksums (if published)
# If the release page includes a checksums file (e.g., SHA256SUMS):
# Download it and compare each hash
# If no checksums are published, record this fact and rely on our computed hashes

# Step 7: Lock down hash file
Set-ItemProperty -Path $hashFile -Name IsReadOnly -Value $true
```

## K3. Hardened Installation

### Installation Approach

1. **Portable, local install** inside `D:\ProjectsHome\LLM_Enclave\QWEN35\openclaw\install\`
2. **No global installs.** No modifications to global PATH.
3. **No Docker by default.** If Docker is required:
   - Container must have `--network none` (no outbound)
   - Container must run as non-root (`--user 1000:1000`)
   - Container mounts only: `D:\ProjectsHome\LLM_Enclave\QWEN35\` (read-write) and nothing else
   - Container must not mount Docker socket

### Python/Node Dependency Pinning

If OpenClaw requires Python:
```powershell
# Create isolated venv
python -m venv "D:\ProjectsHome\LLM_Enclave\QWEN35\openclaw\install\venv"

# Generate requirements with hashes
& "D:\ProjectsHome\LLM_Enclave\QWEN35\openclaw\install\venv\Scripts\pip.exe" `
    install pip-tools
& "D:\ProjectsHome\LLM_Enclave\QWEN35\openclaw\install\venv\Scripts\pip-compile" `
    --generate-hashes `
    --output-file "D:\ProjectsHome\LLM_Enclave\QWEN35\openclaw\install\requirements-locked.txt" `
    "D:\ProjectsHome\LLM_Enclave\QWEN35\openclaw\install\requirements.txt"

# Install with hash verification
& "D:\ProjectsHome\LLM_Enclave\QWEN35\openclaw\install\venv\Scripts\pip.exe" `
    install --require-hashes `
    -r "D:\ProjectsHome\LLM_Enclave\QWEN35\openclaw\install\requirements-locked.txt"
```

If OpenClaw requires Node.js:
```powershell
# Use a local Node.js installation (portable)
# Download Node.js LTS zip from https://nodejs.org/en/download/
# Extract to D:\ProjectsHome\LLM_Enclave\QWEN35\openclaw\install\node\

# Use npm ci (not npm install) with a lockfile
$env:PATH = "D:\ProjectsHome\LLM_Enclave\QWEN35\openclaw\install\node;$env:PATH"
cd "D:\ProjectsHome\LLM_Enclave\QWEN35\openclaw\install"
npm ci --ignore-scripts  # Do not execute post-install scripts
```

## K4. Containment Rules for OpenClaw

OpenClaw inherits the same containment as the Ollama runtime:

1. **File access**: Only `D:\ProjectsHome\LLM_Enclave\QWEN35\` and its children.
2. **Network access**: Blocked outbound via Windows Firewall rules.
3. **Bridge access**: Only through `workspace_bridge\inbox\`, `outbox\`, and `scratch\`.
4. **No scanning of D:\ProjectsHome**: OpenClaw must not be configured to index, scan, or watch directories outside the enclave.

Firewall rules for OpenClaw are created in Deliverable M.

## K5. OpenClaw Info Capture Bundle

See file H10 (`openclaw_install_record.md`) for the complete info capture bundle containing:
- Installed version
- Commit hash or release tag
- List of installed components
- Dependency versions
- Install date and machine context
- How to verify integrity again
- How to update safely
- How to fully remove it

Stored at: `D:\ProjectsHome\LLM_Enclave\QWEN35\docs\openclaw_install_record.md`
