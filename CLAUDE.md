# Claude Code Session Guide - exo

## Project Overview

exo is a distributed AI inference system that lets you run AI models across multiple everyday devices (phones, tablets, laptops) connected as a cluster.

## Baseline Branch Architecture

This repository uses a **branch-first baseline architecture**. Before starting work:

1. **Read `.baseline/CLAUDE_CODE_ENTRYPOINT.md`** for full session guidance
2. **Never modify `main` directly** - always work on a branch
3. **Never modify `.baseline/` governance files** without explicit authorization
4. **Consult `.baseline/inheritance_map.json`** when creating new branches
5. **Determine risk tier** (0-4) for any new system (see `.baseline/RISK_TIER_MODEL.md`)

## Coding Standards

- **Indent:** 2 spaces
- **Max line length:** 200
- **Formatter:** black
- **Linter:** ruff + pylint
- **Import sorter:** isort (profile=black)
- **Style:** See `pyproject.toml` and `ruff.toml` for full configuration

## Project Structure

```
exo/
  api/          - ChatGPT-compatible API server
  download/     - Model download management
  inference/    - Inference engines (MLX for macOS, tinygrad for cross-platform)
  networking/   - Node discovery (UDP) and communication (gRPC)
  orchestration/ - Distributed task orchestration
  topology/     - Network topology and model partitioning
  stats/        - Metrics and statistics
  viz/          - Visualization
```

## Key Entry Points

- `main.py` - Application entry point
- `exo/api/` - API server
- `exo/orchestration/` - Core orchestration logic
- `exo/networking/` - Network layer

## Development Commands

```bash
# Format code
python format.py

# Lint
bash lint.sh

# Install
pip install -e .
```

## Branch Creation

To create a new branch, use:
```bash
python .baseline/scripts/create_branch.py --name <name> --type <type> --purpose "<purpose>" --risk-tier <0-4>
```

See `.baseline/BRANCH_CREATION_GUIDE.md` for details.
