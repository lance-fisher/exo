# Claude Code Session Guide - exo

## Governance Hierarchy (Read This First)

This project lives inside the `D:\ProjectsHome` ecosystem. The **root-level governance files** at `D:\ProjectsHome` (including the root `CLAUDE.md` and any other root rules files) are **authoritative and take precedence** over everything in this project. They must:

- **Never be altered, overwritten, minimized, or replaced** by any action taken within this project
- **Never be contradicted** by project-level or branch-level rules
- **Only ever be added to** — and only in ways that enhance security, privacy, and protection of data and personal information (including data on the local device)

**Precedence order:** Root governance (`D:\ProjectsHome`) > Project governance (`CLAUDE.md` + `.baseline/`) > Branch-local rules

If any instruction in this project conflicts with a root-level rule, the root-level rule wins unconditionally.

## Project Overview

exo is a distributed AI inference system that lets you run AI models across multiple everyday devices (phones, tablets, laptops) connected as a cluster.

## Baseline Branch Architecture

This repository uses a **branch-first baseline architecture**. Before starting work:

1. **Respect root governance** — all `D:\ProjectsHome` root rules files are authoritative and must not be altered
2. **Read `.baseline/CLAUDE_CODE_ENTRYPOINT.md`** for full session guidance
3. **Never modify `main` directly** — always work on a branch
4. **Never modify `.baseline/` governance files** without explicit authorization
5. **Consult `.baseline/inheritance_map.json`** when creating new branches
6. **Determine risk tier** (0-4) for any new system (see `.baseline/RISK_TIER_MODEL.md`)

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
