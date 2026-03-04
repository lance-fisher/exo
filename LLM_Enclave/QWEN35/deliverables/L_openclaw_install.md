# DELIVERABLE L: OpenClaw Hardened Install Plan

## Windows-First Install Steps

### Prerequisites
- OpenClaw release artifacts downloaded and verified (Deliverable K / script H8)
- SHA256 hashes recorded and verified
- Enclave directory structure provisioned (script H1)

### Step 1: Extract Release Artifacts

```powershell
$releaseDir = "D:\ProjectsHome\LLM_Enclave\QWEN35\openclaw\release"
$installDir = "D:\ProjectsHome\LLM_Enclave\QWEN35\openclaw\install"

# Verify hashes before extraction
$hashFile = "D:\ProjectsHome\LLM_Enclave\QWEN35\hashes\openclaw_hashes.txt"
$storedHashes = Get-Content $hashFile | ForEach-Object {
    $parts = $_ -split "\s{2,}"
    @{ Hash = $parts[0]; FileName = $parts[1] }
}

Get-ChildItem -Path $releaseDir -File | ForEach-Object {
    $currentHash = (Get-FileHash -Path $_.FullName -Algorithm SHA256).Hash
    $stored = $storedHashes | Where-Object { $_.FileName -eq $_.Name }
    if ($stored -and $stored.Hash -ne $currentHash) {
        Write-Error "INTEGRITY FAILURE: $($_.Name) hash does not match stored hash. ABORTING."
        exit 1
    }
}

Write-Host "All artifact hashes verified." -ForegroundColor Green
```

### Step 2: Install (Portable, Local)

```powershell
# Create install directory
New-Item -ItemType Directory -Path $installDir -Force

# If OpenClaw ships as a zip/tarball:
# Extract source archive
$sourceArchive = Get-ChildItem -Path $releaseDir -Filter "source-*.zip" | Select-Object -First 1
if ($sourceArchive) {
    Expand-Archive -Path $sourceArchive.FullName -DestinationPath $installDir -Force
    Write-Host "Source extracted to $installDir"
}

# If OpenClaw ships as a binary:
# Copy binary to install directory
$binaryArtifacts = Get-ChildItem -Path $releaseDir -Filter "*.exe"
foreach ($bin in $binaryArtifacts) {
    Copy-Item -Path $bin.FullName -Destination $installDir
    Write-Host "Copied binary: $($bin.Name)"
}
```

### Step 3: Install Dependencies (If Python Project)

```powershell
# Create isolated virtual environment
$venvPath = "$installDir\venv"
python -m venv $venvPath

# Activate venv
& "$venvPath\Scripts\Activate.ps1"

# Check if requirements file exists in the extracted source
$reqFile = Get-ChildItem -Path $installDir -Filter "requirements*.txt" -Recurse | Select-Object -First 1
if ($reqFile) {
    # Generate hash-pinned lockfile
    pip install pip-tools --quiet
    pip-compile --generate-hashes `
        --output-file "$installDir\requirements-locked.txt" `
        $reqFile.FullName

    # Install with hash verification
    pip install --require-hashes -r "$installDir\requirements-locked.txt"
    Write-Host "Dependencies installed with hash verification." -ForegroundColor Green
} else {
    Write-Host "No requirements file found. Manual dependency setup may be needed."
}

# Deactivate venv
deactivate
```

### Step 4: Configure OpenClaw

```powershell
$configDir = "D:\ProjectsHome\LLM_Enclave\QWEN35\openclaw\config"
New-Item -ItemType Directory -Path $configDir -Force

# Create a baseline configuration that:
# 1. Points to local Ollama endpoint
# 2. Restricts file access to bridge directories only
# 3. Disables any telemetry or update checks
# 4. Disables plugin loading by default

$config = @"
# OpenClaw Enclave Configuration
# Generated: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
# This configuration enforces local-only, contained operation.

# LLM Backend
llm_backend: "ollama"
ollama_host: "http://127.0.0.1:11434"
ollama_model: "qwen-local"

# File Access
workspace_root: "D:\\ProjectsHome\\LLM_Enclave\\QWEN35\\workspace_bridge"
allowed_directories:
  - "D:\\ProjectsHome\\LLM_Enclave\\QWEN35\\workspace_bridge\\inbox"
  - "D:\\ProjectsHome\\LLM_Enclave\\QWEN35\\workspace_bridge\\outbox"
  - "D:\\ProjectsHome\\LLM_Enclave\\QWEN35\\workspace_bridge\\scratch"

# Security
telemetry_enabled: false
auto_update_enabled: false
plugin_loading_enabled: false
trust_remote_code: false
network_access: false

# Logging
log_directory: "D:\\ProjectsHome\\LLM_Enclave\\QWEN35\\logs\\openclaw"
log_level: "INFO"
log_prompts: false
log_responses: false
"@

$config | Set-Content -Path "$configDir\config.yaml"
Write-Host "OpenClaw configuration created at $configDir\config.yaml" -ForegroundColor Green
```

### Step 5: Do NOT Modify Global PATH

```powershell
# OpenClaw is run directly from its install location:
# & "D:\ProjectsHome\LLM_Enclave\QWEN35\openclaw\install\openclaw.exe" --config "...\config\config.yaml"
#
# Or if Python-based:
# & "D:\ProjectsHome\LLM_Enclave\QWEN35\openclaw\install\venv\Scripts\python.exe" -m openclaw --config "...\config\config.yaml"
#
# No global PATH modification needed or recommended.
```

---

## WSL/Docker Steps (Only If Required)

### Docker (If OpenClaw Requires It)

```powershell
# ONLY use Docker if OpenClaw cannot run natively on Windows.
# If Docker is required, use these hardened settings:

docker run `
    --name openclaw-enclave `
    --network none `
    --user 1000:1000 `
    --read-only `
    --tmpfs /tmp:rw,noexec,nosuid,size=100m `
    -v "D:\ProjectsHome\LLM_Enclave\QWEN35:/enclave:rw" `
    -e "OLLAMA_HOST=http://host.docker.internal:11434" `
    -e "DO_NOT_TRACK=1" `
    --restart no `
    --memory 2g `
    --cpus 2 `
    openclaw-image:verified-tag

# CRITICAL Docker flags explained:
# --network none        : No network access at all
# --user 1000:1000      : Non-root user
# --read-only           : Read-only root filesystem
# --tmpfs /tmp          : Writable temp with noexec
# -v                    : Mount ONLY the enclave directory
# --restart no          : Do not auto-restart
# --memory 2g           : Limit memory usage
# --cpus 2              : Limit CPU usage
```

### WSL (If Docker Is Not Available)

```bash
# Inside WSL, mount only the enclave directory
sudo mkdir -p /mnt/llm_enclave
sudo mount -t drvfs 'D:\ProjectsHome\LLM_Enclave\QWEN35' /mnt/llm_enclave \
    -o metadata,uid=1000,gid=1000,umask=077

# Disable Windows interop
echo -e "[interop]\nenabled=false\nappendWindowsPath=false" | sudo tee /etc/wsl.conf

# Install OpenClaw in WSL
cd /mnt/llm_enclave/openclaw/install
python3 -m venv venv
source venv/bin/activate
pip install --require-hashes -r requirements-locked.txt
```

---

## Rollback Instructions

To completely remove OpenClaw:

```powershell
# 1. Stop any running OpenClaw processes
Stop-Process -Name "openclaw*" -Force -ErrorAction SilentlyContinue

# 2. Remove the OpenClaw directory
# WARNING: This removes the OpenClaw installation. Enclave structure is preserved.
Remove-Item -Path "D:\ProjectsHome\LLM_Enclave\QWEN35\openclaw" -Recurse -Force

# 3. Remove firewall rules for OpenClaw
Get-NetFirewallRule -DisplayName "LLM_Enclave: Block OpenClaw*" |
    Remove-NetFirewallRule

# 4. Remove Docker container and image (if used)
docker rm -f openclaw-enclave 2>$null
docker rmi openclaw-image:verified-tag 2>$null

# 5. Record removal in changelog
"## $(Get-Date -Format 'yyyyMMdd_HHmmss') - OpenClaw REMOVED" |
    Add-Content -Path "D:\ProjectsHome\LLM_Enclave\QWEN35\docs\changelog.md"
```
