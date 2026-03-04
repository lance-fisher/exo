# DELIVERABLE A: Threat Model for Local LLM Deployments

## A1. Supply Chain Risks

### Model Weights
- **Tampered weights**: Model files downloaded from unofficial mirrors or forks may contain backdoored weights that produce subtly malicious outputs (data exfiltration via generated code, prompt injection steering).
- **Unverified provenance**: GGUF, safetensors, or other model formats downloaded without hash verification could be swapped or corrupted in transit.
- **Model repository code execution**: Hugging Face repositories can contain arbitrary Python in `config.py`, `tokenizer.py`, or custom model code. Loading a model with `trust_remote_code=True` executes attacker-controlled code.
- **Quantization supply chain**: Pre-quantized models from community sources may differ from the original weights in ways that introduce unexpected behavior.

### Runtime Binaries
- **Unsigned binaries**: Ollama, llama.cpp, and similar runtimes distribute binaries that may not be code-signed. A compromised download mirror could serve trojanized binaries.
- **Build reproducibility**: Most runtimes do not offer reproducible builds, making it difficult to verify that a binary matches its source code.
- **Transitive dependencies**: Runtimes may dynamically load shared libraries (CUDA, cuBLAS, OpenBLAS) that introduce additional trust requirements.

### Python Dependencies
- **Dependency confusion attacks**: pip can be tricked into installing malicious packages from PyPI that shadow internal or intended packages.
- **Unpinned transitive dependencies**: Even if top-level packages are pinned, their dependencies may not be, allowing supply chain attacks through transitive updates.
- **Post-install hooks**: Python packages can execute arbitrary code during installation via setup.py or pyproject.toml build hooks.

### Package Managers
- **npm/pip/cargo without lockfiles**: Installing without hash-pinned lockfiles allows silent substitution.
- **Auto-update behavior**: Some package managers check for updates on every invocation, leaking usage metadata.

## A2. Data Exfiltration Paths

### Outbound Network
- **Direct HTTP/HTTPS calls**: A compromised runtime or plugin could POST prompt data or generated code to an external endpoint.
- **WebSocket connections**: Some runtimes open WebSocket servers; if bound to 0.0.0.0 instead of 127.0.0.1, they are accessible from the network.
- **gRPC or custom protocols**: vLLM and some serving frameworks use gRPC which could be configured to reach external endpoints.

### DNS
- **DNS exfiltration**: Data can be encoded in DNS queries. A compromised process could leak data via DNS lookups even if HTTP is blocked.
- **DNS-over-HTTPS**: Bypasses traditional DNS blocking by tunneling queries over HTTPS to public resolvers.

### Proxies
- **System proxy settings**: If a system-wide proxy is configured, blocked processes may route traffic through it, bypassing firewall rules.
- **Environment variable proxies**: HTTP_PROXY, HTTPS_PROXY, ALL_PROXY environment variables can redirect traffic.

### Unexpected Telemetry
- **Ollama telemetry**: Ollama has historically included telemetry that phones home. Even if disabled, updates may re-enable it.
- **Python package telemetry**: Libraries like transformers, torch, and huggingface_hub may send usage statistics.
- **CUDA/GPU driver telemetry**: NVIDIA drivers and CUDA toolkit may send telemetry to NVIDIA servers.

### Plugin Ecosystems
- **OpenClaw/Open-WebUI plugins**: Plugins can execute arbitrary code with the permissions of the parent process.
- **MCP servers**: Model Context Protocol servers can be used to extend capabilities but also introduce arbitrary network access.

## A3. Data Leakage Risks

### Prompts and Context Windows
- **Prompt logging**: Runtimes may log full prompts to stdout, stderr, or log files, capturing sensitive project code.
- **Context window persistence**: Some runtimes cache conversation history on disk in unencrypted form.

### Logs
- **Verbose logging**: Debug-level logs may contain full request/response payloads including source code.
- **Log rotation failures**: Unrotated logs grow indefinitely, increasing the attack surface for data at rest.

### Crash Dumps
- **Windows Error Reporting**: WER can capture full process memory (including prompts and model state) and, by default, may upload them to Microsoft.
- **Core dumps**: If running under WSL, core dumps may be written to predictable locations.

### Swap/Pagefile
- **Pagefile exposure**: Windows pagefile (C:\pagefile.sys) may contain fragments of model inference data, prompts, or generated code.
- **Hibernation file**: hiberfil.sys captures full RAM contents.

### Temp Directories
- **%TEMP% leakage**: Runtimes may write temporary files containing prompts or model outputs to the user's temp directory.
- **WSL /tmp**: If using WSL, /tmp is world-readable by default.

## A4. Corruption Risks

### Accidental Writes to Project Files
- **Working directory mistakes**: If the runtime is started from a project directory, relative path operations may read/write project files.
- **Shell escapes**: If a model generates and a user executes shell commands, those commands run with the user's full permissions.

### Destructive Edits
- **Overwrite without backup**: Applying model-generated patches without backup creates unrecoverable states.
- **Binary file corruption**: Attempting to apply text patches to binary files can corrupt them silently.

### Path Traversal
- **Relative path attacks**: Model-generated file paths like `../../other_project/secrets.env` could escape the intended workspace.
- **Symlink attacks**: A model could suggest creating symlinks that point outside the enclave.

### Overbroad Permissions
- **Running as the primary user**: The runtime inherits all file permissions of the launching user, giving it access to everything the user can access.

## A5. Privilege Risks

### Running as Admin
- **Elevated inference**: Running the runtime as Administrator gives it access to all system files and the ability to modify firewall rules, install services, and access other users' data.
- **UAC bypass**: Some tools request elevation unnecessarily.

### WSL Interop
- **Windows-to-WSL bridge**: By default, WSL can execute Windows binaries and vice versa. A compromised WSL process can run `cmd.exe` or `powershell.exe` on the Windows side.
- **Shared /mnt/c**: WSL mounts the entire C: drive by default, giving full read/write access to Windows files from within WSL.
- **Shared /mnt/d**: Similarly, D: drive is mounted, meaning WSL processes can access D:\ProjectsHome directly.

### Shared Mounts
- **Docker volume mounts**: Overly broad Docker volume mounts (e.g., mounting D:\ instead of just the enclave) expose all project data to containers.

### Overly Permissive Firewall Rules
- **Program-based rules vs path-based**: Windows Firewall rules based on program name can be bypassed by renaming executables.
- **Rule ordering**: Allow rules take precedence if not carefully ordered.

## A6. Human Error Risks

### Running Commands from Untrusted READMEs
- **Blind copy-paste**: Running `curl | bash` or `iex (irm ...)` from project READMEs without review.
- **Obfuscated commands**: Base64-encoded or compressed command strings hide malicious intent.

### Copy-Pasting Without Review
- **Model-generated commands**: Executing shell commands suggested by the model without reading them first.
- **Clipboard hijacking**: Some web pages can modify clipboard contents, replacing a copied command with a malicious one.
- **Invisible characters**: Unicode direction-override characters can make displayed text differ from actual content.

### Configuration Drift
- **Disabling security for convenience**: Temporarily disabling firewall rules and forgetting to re-enable them.
- **Permission creep**: Gradually adding more paths to the allowlist without reviewing the overall exposure.
- **Stale policies**: Not updating deny patterns as new secret formats emerge.
