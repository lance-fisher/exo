# DELIVERABLE S: Qwen Model Selection and Sizing Guidance

## S1. Recommended Default Model Size

### Primary Recommendation: Qwen2.5-Coder-7B-Instruct (Q4_K_M quantization)

**Why 7B as default:**

| Factor | Reasoning |
|--------|-----------|
| VRAM requirement | ~6 GB at Q4_K_M. Fits on most modern GPUs (RTX 3060 12GB, RTX 4060 8GB, RTX 3080 10GB, etc.) |
| Speed | 20-40 tokens/second on consumer GPUs at Q4_K_M. Fast enough for interactive coding |
| Quality | The 7B-Instruct variant is specifically tuned for code tasks. Adequate for routine development: refactors, docs, patches, reviews, boilerplate |
| Context window | 32K tokens (Qwen2.5 series). Sufficient for most single-file and multi-file tasks |
| Practicality | Large enough to produce useful output, small enough to run comfortably alongside other applications |

### Alternative Sizes

| Model | VRAM (Q4_K_M) | Use Case | Trade-off |
|-------|---------------|----------|-----------|
| Qwen2.5-Coder-1.5B | ~2 GB | Ultra-light tasks, code completion, quick lookups | Lower quality, may struggle with complex reasoning |
| Qwen2.5-Coder-3B | ~3 GB | Light coding tasks on systems with limited VRAM | Better than 1.5B, still limited on complex tasks |
| Qwen2.5-Coder-7B | ~6 GB | **DEFAULT** - routine development, refactors, docs | Good balance of quality and speed |
| Qwen2.5-Coder-14B | ~10 GB | Complex tasks that 7B struggles with | Requires more VRAM, slower |
| Qwen2.5-Coder-32B | ~20 GB | Near-frontier quality for complex reasoning | Requires high-end GPU (RTX 4090, A6000) |

### Decision Framework

```
IF your GPU has <4 GB VRAM:
    Use 1.5B or 3B (limited but functional)

IF your GPU has 6-8 GB VRAM:
    Use 7B Q4_K_M (DEFAULT)

IF your GPU has 10-16 GB VRAM:
    Use 7B Q5_K_M or Q6_K for better quality
    OR use 14B Q4_K_M for smarter output

IF your GPU has 20+ GB VRAM:
    Use 32B Q4_K_M for best local quality
    OR use 14B Q6_K for high quality + fast speed

IF you have NO GPU (CPU only):
    Use 3B or 1.5B with Q4_K_M
    Expect 2-5 tokens/second (usable but slow)
```

### Important Note on Model Naming

The string "QWEN 3.5" was specified in the original requirements. At the time of this document's creation:

- The latest released Qwen coding model series is **Qwen2.5-Coder** (released by Alibaba/Qwen team).
- There is no model officially named "Qwen 3.5" in the Qwen release history as of the knowledge cutoff.
- The system is designed so you can swap in ANY model identifier without changing the security posture.

**To swap models:**
1. Download the new model GGUF file to `models\staging\`.
2. Verify SHA256.
3. Move to `models\verified\`.
4. Update the Ollama Modelfile (`runtime\config\Modelfile`) to point to the new file.
5. Run `ollama create qwen-local -f Modelfile`.
6. All security controls (firewall, ACLs, bridge, policies) remain unchanged.

## S2. Keeping It Stable and Fast Locally

### Quantization Guidance

All quantization happens locally using already-quantized GGUF files. No cloud services needed.

| Quantization | Size Reduction | Quality Impact | Recommendation |
|-------------|---------------|----------------|----------------|
| Q2_K | ~70% smaller | Significant quality loss | Not recommended for coding |
| Q3_K_M | ~60% smaller | Noticeable quality loss | Only if VRAM is very limited |
| Q4_K_M | ~50% smaller | Minor quality loss | **RECOMMENDED DEFAULT** |
| Q5_K_M | ~40% smaller | Minimal quality loss | Good if you have the VRAM |
| Q6_K | ~30% smaller | Nearly lossless | Best quality-to-size ratio |
| Q8_0 | ~20% smaller | Lossless (perceptually) | Use if VRAM is abundant |
| F16 | Full size | No loss | Requires 2x the VRAM of Q4_K_M |

### Performance Tuning

```powershell
# Ollama environment variables for performance
$env:OLLAMA_NUM_PARALLEL = "1"        # Single request at a time (stability)
$env:OLLAMA_MAX_LOADED_MODELS = "1"   # Only one model in memory
$env:OLLAMA_KEEP_ALIVE = "30m"        # Keep model loaded for 30 minutes
$env:OLLAMA_HOST = "127.0.0.1:11434"  # Bind to localhost only

# GPU-specific settings
$env:OLLAMA_GPU_LAYERS = "-1"         # Offload all layers to GPU (auto-detect)
# If you want to limit GPU usage:
# $env:OLLAMA_GPU_LAYERS = "20"       # Offload only 20 layers, rest on CPU

# Context window
# Default is 2048. For coding tasks, increase:
# Set in Modelfile: PARAMETER num_ctx 8192
```

### Stability Best Practices

1. **Do not run multiple models simultaneously** unless you have abundant VRAM.
2. **Monitor VRAM usage** with `nvidia-smi` (if NVIDIA GPU) or Task Manager.
3. **If you experience crashes or slowdowns**, reduce `num_ctx` or switch to a smaller quantization.
4. **Set `OLLAMA_KEEP_ALIVE`** to prevent constant model loading/unloading.
5. **Do not run other GPU-heavy applications** (games, video rendering) while using the model.

### Ollama Modelfile Template

```
# D:\ProjectsHome\LLM_Enclave\QWEN35\runtime\config\Modelfile
FROM D:\ProjectsHome\LLM_Enclave\QWEN35\models\verified\MODEL_FILE_NAME_HERE.gguf

# Parameters
PARAMETER temperature 0.3
PARAMETER top_p 0.9
PARAMETER num_ctx 8192
PARAMETER stop "<|im_end|>"
PARAMETER stop "<|endoftext|>"

# System prompt (optional, can be set per-request instead)
SYSTEM """You are a helpful coding assistant. You produce clean, correct, well-structured code. You explain your reasoning when asked. You do not access external resources or make network calls."""
```

## S3. Model Swappability Without Security Impact

**Hard Rule:** The security posture does not change when the model changes.

### What Stays the Same Regardless of Model

| Security Control | Model-Independent? |
|-----------------|-------------------|
| Firewall rules (outbound block) | Yes - blocks the Ollama process, not the model |
| NTFS ACLs | Yes - restricts the user/process, not the model |
| Bridge workflow (inbox/outbox) | Yes - file routing is independent of model |
| Policy file (deny patterns, size limits) | Yes - enforced by scripts, not by model |
| Secret scanning | Yes - regex-based, runs before model sees data |
| Audit logging | Yes - logs operations, not model internals |
| Restricted user | Yes - OS-level, model-agnostic |

### Model Swap Procedure

```powershell
# 1. Download new model to staging
$newModel = "new-model-name.gguf"
# (follow download and verification procedure)

# 2. Move verified model to verified directory
Move-Item "models\staging\$newModel" "models\verified\$newModel"

# 3. Update Modelfile
$modelfilePath = "D:\ProjectsHome\LLM_Enclave\QWEN35\runtime\config\Modelfile"
# Edit the FROM line to: FROM D:\ProjectsHome\LLM_Enclave\QWEN35\models\verified\$newModel

# 4. Recreate Ollama model
& "D:\ProjectsHome\LLM_Enclave\QWEN35\runtime\bin\ollama.exe" create qwen-local `
    -f $modelfilePath

# 5. Test
& "D:\ProjectsHome\LLM_Enclave\QWEN35\runtime\bin\ollama.exe" run qwen-local "Confirm you are running."

# 6. Record in changelog
"## $(Get-Date -Format 'yyyyMMdd_HHmmss') - Model swapped to $newModel" | `
    Add-Content -Path "D:\ProjectsHome\LLM_Enclave\QWEN35\docs\changelog.md"

# Security posture: UNCHANGED
# All firewall rules, ACLs, bridge policies, and scripts remain as-is.
```
