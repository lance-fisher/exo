# Claude Code — Project Instructions

## Project Overview

exo is a distributed AI inference framework that lets you run AI models across multiple everyday devices (Mac, Linux, iPhone, iPad, Android) connected peer-to-peer. It splits models across devices based on available memory and provides a ChatGPT-compatible API.

- **Language**: Python 3.12+
- **Key entrypoint**: `main.py`
- **Core package**: `exo/`
- **Tests**: Run with `pytest` from repo root
- **Linting**: `bash lint.sh` (uses ruff)
- **Formatting**: `python format.py` (uses ruff)

## Session Handover Protocol

When starting a new session, **always check for `.claude/handover.md`** first. If it exists, read it before doing anything else — it contains context from the previous session including what was done, key decisions, current state, and next steps.

Before ending a session or when context is getting large, run `/handover` to generate an updated handover document.

A PreCompact hook is configured to automatically prompt handover generation before context compaction, so session continuity is preserved even if you don't manually run `/handover`.

## Conventions

- Keep changes focused and minimal — avoid unnecessary refactoring
- Reference specific file paths and function names in discussions
- Run `bash lint.sh` before committing to check for lint errors
- Run tests with `pytest` to verify changes
