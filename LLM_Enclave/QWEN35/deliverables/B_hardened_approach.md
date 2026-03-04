# DELIVERABLE B: Hardened Approach Decision

## PRIMARY RUNTIME: Ollama

## SECONDARY FALLBACK: llama.cpp (direct binary)

---

## B1. Why Ollama Best Supports Offline, Minimal Dependency, and Controllable Network Behavior on Windows

### Justification

**Ollama is selected as PRIMARY** for the following reasons:

1. **Native Windows support**: Ollama ships as a single installer for Windows with no Python dependency. This eliminates the entire Python supply chain risk (pip, PyPI, transitive dependencies, setup.py code execution) from the core inference path.

2. **Self-contained binary**: The Ollama executable bundles llama.cpp internally. There is one binary to trust, one binary to hash, one binary to firewall-block. This is the smallest trust surface among the options.

3. **No mandatory network after initial setup**: Once a model is downloaded and imported, Ollama operates entirely offline. The server binds to 127.0.0.1:11434 by default and does not require internet connectivity for inference.

4. **Controllable network behavior**: Ollama's network activity is limited to:
   - Model pulls (which we will do manually with hash verification, then import locally)
   - The local API server on localhost
   Both are controllable. We block outbound at the firewall level for the ollama.exe process entirely.

5. **GGUF model format support**: Ollama uses GGUF format, which is a static binary blob with no executable code. Model files cannot execute code on load, unlike PyTorch .bin files or Hugging Face models with custom code.

6. **Simple API**: Ollama exposes a REST API on localhost that OpenClaw and other tools can consume without complex configuration.

7. **Telemetry control**: Ollama telemetry can be disabled via environment variable `OLLAMA_NOPRUNE=1` and by blocking outbound network. We will set `OLLAMA_ORIGINS` to restrict CORS and set `OLLAMA_HOST=127.0.0.1:11434` to bind only to localhost.

8. **Quantization built-in**: Ollama handles quantized models natively, making it practical to run large models on consumer hardware without additional tooling.

**llama.cpp is selected as SECONDARY FALLBACK** because:
- It is the upstream project that Ollama wraps.
- If Ollama introduces unacceptable changes (forced telemetry, license changes, supply chain compromise), llama.cpp provides the same inference capability with even fewer dependencies.
- It compiles from source, allowing full audit.
- It requires more manual setup, hence its secondary position.

### Why NOT the others

- **vLLM**: Linux-only, requires Python, CUDA dependencies, and is designed for serving workloads. Overkill and not Windows-native.
- **Transformers (PyTorch)**: Requires Python, pip, torch, and the entire Hugging Face ecosystem. The supply chain surface is enormous. `trust_remote_code` is a constant risk. Model loading can execute arbitrary Python.

---

## B2. Artifacts That Must Be Trusted

### Ollama Binary
- **Source**: https://ollama.com/download/windows
- **Trust requirement**: The downloaded installer or zip must be verified against published checksums. Ollama publishes GitHub releases with SHA256 checksums.
- **Verification**: Download from the official GitHub releases page (https://github.com/ollama/ollama/releases), compute SHA256, compare against the published hash.
- **Risk**: Ollama binaries are not code-signed with an EV certificate. This means we rely on hash verification, not signature verification.

### Model Files (GGUF format)
- **Source**: Official Qwen repositories on Hugging Face, or community quantizations from verified uploaders (e.g., official Qwen team uploads).
- **Trust requirement**: Download specific file by exact filename and revision hash. Compute SHA256 and store it. Never re-download without re-verifying.
- **Risk**: GGUF files are inert data (weights + metadata). They cannot execute code on load. The risk is limited to tampered weights producing unexpected outputs, not code execution.

### Modelfile (Ollama configuration)
- **Source**: Created locally by us.
- **Trust requirement**: We write it. No external trust needed.
- **Risk**: Minimal. It is a plain text configuration.

---

## B3. How Updates Will Be Handled Safely

### Runtime Updates (Ollama)
1. **No auto-update**: Set `OLLAMA_NOPRUNE=1` and block outbound network. Ollama cannot check for or download updates.
2. **Manual update procedure**:
   a. Temporarily enable outbound network for the download (not for ollama.exe, but for browser/curl).
   b. Download the new release from https://github.com/ollama/ollama/releases.
   c. Compute SHA256 of the downloaded file.
   d. Compare against the hash published on the GitHub release page.
   e. Store the old binary in `D:\ProjectsHome\LLM_Enclave\QWEN35\backups\runtime\` with a timestamp.
   f. Install the new binary.
   g. Update the hash record in `D:\ProjectsHome\LLM_Enclave\QWEN35\hashes\runtime_hashes.txt`.
   h. Record the change in `D:\ProjectsHome\LLM_Enclave\QWEN35\docs\changelog.md`.
   i. Re-verify firewall rules are still in place for the new binary path.
   j. Revoke outbound network access.

### Model Updates
1. **Pinned revisions**: Every model download uses a specific Hugging Face revision hash or exact file URL.
2. **No silent re-downloads**: The download script refuses to overwrite existing model files. New versions get a new directory.
3. **Manual update procedure**:
   a. Download new model files to a staging directory.
   b. Compute and verify SHA256.
   c. Import into Ollama under a new tag (e.g., `qwen:v2`).
   d. Test the new model.
   e. Update the Modelfile to point to the new version.
   f. Keep the old version until explicitly removed.
   g. Record the change in the changelog.

### Dependency Updates (if any Python is used for tooling)
1. **Pinned with hashes**: All Python dependencies use `pip install --require-hashes -r requirements.txt`.
2. **No auto-install**: The venv is created once and updated only through the explicit update procedure.
3. **Lockfile stored**: The `requirements.txt` with hashes is version-controlled and stored in the enclave.
