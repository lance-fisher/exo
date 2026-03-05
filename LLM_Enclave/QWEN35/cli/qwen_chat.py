#!/usr/bin/env python3
"""
Qwen Chat CLI — Local "Claude Code"-like experience for the LLM Enclave.

Connects to Ollama (127.0.0.1:11434) running Qwen locally.
Reads from workspace_bridge/inbox, writes to workspace_bridge/outbox.
Zero network, zero telemetry, zero cloud.

Usage:
    python qwen_chat.py
    python qwen_chat.py --project MyProject
"""

import json
import os
import sys
import re
import urllib.request
import urllib.error
import shutil
import textwrap
from pathlib import Path
from datetime import datetime

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
OLLAMA_HOST = os.environ.get("OLLAMA_HOST", "http://127.0.0.1:11434")
if not OLLAMA_HOST.startswith("http"):
    OLLAMA_HOST = f"http://{OLLAMA_HOST}"
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "qwen-local")

# Detect enclave root (works on both Windows and Linux)
ENCLAVE_ROOT = Path(__file__).resolve().parent.parent
PROJECTS_ROOT = ENCLAVE_ROOT.parent.parent

BRIDGE_ROOT = ENCLAVE_ROOT / "workspace_bridge"
INBOX = BRIDGE_ROOT / "inbox"
OUTBOX = BRIDGE_ROOT / "outbox"
SCRATCH = BRIDGE_ROOT / "scratch"
LOG_DIR = ENCLAVE_ROOT / "logs" / "cli"

# ---------------------------------------------------------------------------
# Globals
# ---------------------------------------------------------------------------
conversation_history = []
current_project = None
terminal_width = shutil.get_terminal_size((80, 24)).columns


# ---------------------------------------------------------------------------
# Ollama API
# ---------------------------------------------------------------------------
def ollama_chat(messages, stream=True):
    """Send a chat request to Ollama and yield streamed response chunks."""
    url = f"{OLLAMA_HOST}/api/chat"
    payload = json.dumps({
        "model": OLLAMA_MODEL,
        "messages": messages,
        "stream": stream,
        "options": {
            "num_ctx": 8192,
        }
    }).encode("utf-8")

    req = urllib.request.Request(
        url,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST"
    )

    try:
        with urllib.request.urlopen(req, timeout=300) as resp:
            full_response = ""
            for line in resp:
                if line:
                    chunk = json.loads(line.decode("utf-8"))
                    token = chunk.get("message", {}).get("content", "")
                    if token:
                        full_response += token
                        yield token
                    if chunk.get("done"):
                        break
            return full_response
    except urllib.error.URLError as e:
        yield f"\n[ERROR] Cannot reach Ollama at {OLLAMA_HOST}: {e}\n"
        yield "Make sure Ollama is running: ollama serve\n"
    except Exception as e:
        yield f"\n[ERROR] {e}\n"


def ollama_check():
    """Check if Ollama is reachable and model is available."""
    try:
        url = f"{OLLAMA_HOST}/api/tags"
        req = urllib.request.Request(url, method="GET")
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            models = [m.get("name", "") for m in data.get("models", [])]
            # Check for exact match or prefix match
            found = any(OLLAMA_MODEL in m for m in models)
            return found, models
    except Exception as e:
        return False, []


# ---------------------------------------------------------------------------
# File Operations (Bridge-Scoped)
# ---------------------------------------------------------------------------
def list_inbox_files(project=None):
    """List files in the inbox, optionally filtered by project."""
    base = INBOX / project if project else INBOX
    if not base.exists():
        return []
    files = []
    for f in sorted(base.rglob("*")):
        if f.is_file():
            rel = f.relative_to(INBOX)
            files.append(str(rel))
    return files


def read_inbox_file(filepath):
    """Read a file from the inbox. Path must be relative to inbox."""
    target = (INBOX / filepath).resolve()
    # Security: ensure path is within inbox
    if not str(target).startswith(str(INBOX.resolve())):
        return None, "Access denied: path outside inbox boundary."
    if not target.exists():
        return None, f"File not found: {filepath}"
    try:
        return target.read_text(encoding="utf-8", errors="replace"), None
    except Exception as e:
        return None, str(e)


def write_outbox_file(filepath, content):
    """Write a file to the outbox. Path must be relative to outbox."""
    target = (OUTBOX / filepath).resolve()
    # Security: ensure path is within outbox
    if not str(target).startswith(str(OUTBOX.resolve())):
        return "Access denied: path outside outbox boundary."
    target.parent.mkdir(parents=True, exist_ok=True)
    try:
        target.write_text(content, encoding="utf-8")
        return None
    except Exception as e:
        return str(e)


def list_outbox_files(project=None):
    """List files in the outbox."""
    base = OUTBOX / project if project else OUTBOX
    if not base.exists():
        return []
    files = []
    for f in sorted(base.rglob("*")):
        if f.is_file():
            rel = f.relative_to(OUTBOX)
            files.append(str(rel))
    return files


# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
def log_interaction(user_msg, assistant_msg):
    """Log interaction metadata (not content) to CLI log."""
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    log_file = LOG_DIR / f"session_{datetime.now().strftime('%Y%m%d')}.log"
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    entry = f"{timestamp} | user_len={len(user_msg)} | assistant_len={len(assistant_msg)} | model={OLLAMA_MODEL}\n"
    with open(log_file, "a", encoding="utf-8") as f:
        f.write(entry)


# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------
SYSTEM_PROMPT = """You are Qwen, a local AI coding assistant running inside a secure LLM Enclave.

You help with coding tasks: writing code, debugging, refactoring, explaining code, and more.
You are running 100% offline via Ollama. No data leaves this machine.

WORKSPACE RULES:
- You can read files the user has imported to the workspace bridge inbox.
- You produce output that goes to the workspace bridge outbox.
- You NEVER access files outside the enclave boundary.
- You NEVER make network calls.
- Keep responses focused, practical, and code-oriented.

When the user shares code or asks about files, help them directly.
When writing code, be precise and complete — the user will apply your output to their project."""


def build_messages(user_input):
    """Build the message list for the Ollama API."""
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    messages.extend(conversation_history)
    messages.append({"role": "user", "content": user_input})
    return messages


def handle_command(cmd):
    """Handle slash commands. Returns True if handled, False otherwise."""
    global current_project, OLLAMA_MODEL
    parts = cmd.strip().split(maxsplit=1)
    command = parts[0].lower()
    arg = parts[1] if len(parts) > 1 else ""

    if command in ("/help", "/h"):
        print_help()
        return True

    elif command in ("/files", "/ls"):
        project = arg or current_project
        inbox_files = list_inbox_files(project)
        outbox_files = list_outbox_files(project)
        print(f"\n  Inbox ({len(inbox_files)} files):")
        for f in inbox_files[:30]:
            print(f"    {f}")
        if len(inbox_files) > 30:
            print(f"    ... and {len(inbox_files) - 30} more")
        print(f"\n  Outbox ({len(outbox_files)} files):")
        for f in outbox_files[:30]:
            print(f"    {f}")
        if len(outbox_files) > 30:
            print(f"    ... and {len(outbox_files) - 30} more")
        print()
        return True

    elif command in ("/read", "/cat"):
        if not arg:
            print("  Usage: /read <path-relative-to-inbox>")
            return True
        content, err = read_inbox_file(arg)
        if err:
            print(f"  Error: {err}")
        else:
            print(f"\n  --- {arg} ---")
            print(content)
            print(f"  --- end ---\n")
        return True

    elif command in ("/include", "/add"):
        if not arg:
            print("  Usage: /include <path-relative-to-inbox>")
            print("  Adds file content to the conversation context.")
            return True
        content, err = read_inbox_file(arg)
        if err:
            print(f"  Error: {err}")
            return True
        msg = f"[File: {arg}]\n```\n{content}\n```"
        conversation_history.append({"role": "user", "content": msg})
        conversation_history.append({"role": "assistant", "content": f"I've loaded `{arg}` ({len(content)} chars). What would you like me to do with it?"})
        print(f"  Added {arg} to context ({len(content)} chars)")
        return True

    elif command in ("/save", "/write"):
        if not arg:
            print("  Usage: /save <path> <content>")
            print("  Or: /save <path> (saves last assistant response)")
            return True
        save_parts = arg.split(maxsplit=1)
        filepath = save_parts[0]
        if len(save_parts) > 1:
            content = save_parts[1]
        elif conversation_history and conversation_history[-1]["role"] == "assistant":
            content = conversation_history[-1]["content"]
        else:
            print("  No content to save. Provide content or chat first.")
            return True
        err = write_outbox_file(filepath, content)
        if err:
            print(f"  Error: {err}")
        else:
            print(f"  Saved to outbox: {filepath}")
        return True

    elif command == "/project":
        if arg:
            current_project = arg
            print(f"  Active project: {current_project}")
        else:
            print(f"  Active project: {current_project or '(none)'}")
            print("  Usage: /project <name>")
        return True

    elif command in ("/clear", "/reset"):
        conversation_history.clear()
        print("  Conversation cleared.")
        return True

    elif command == "/model":
        if arg:
            OLLAMA_MODEL = arg
            print(f"  Model switched to: {OLLAMA_MODEL}")
        else:
            print(f"  Current model: {OLLAMA_MODEL}")
        return True

    elif command in ("/status", "/info"):
        model_ok, models = ollama_check()
        print(f"\n  Ollama:  {OLLAMA_HOST}")
        print(f"  Model:   {OLLAMA_MODEL} ({'available' if model_ok else 'NOT FOUND'})")
        print(f"  Models:  {', '.join(models) if models else '(none)'}")
        print(f"  Project: {current_project or '(none)'}")
        print(f"  Inbox:   {INBOX}")
        print(f"  Outbox:  {OUTBOX}")
        print(f"  History: {len(conversation_history)} messages")
        print()
        return True

    elif command in ("/quit", "/exit", "/q"):
        print("  Goodbye!")
        sys.exit(0)

    return False


def print_help():
    """Print help text."""
    help_text = """
  Qwen Chat - Local AI Coding Assistant
  ======================================

  Just type naturally to chat with Qwen. It works like Claude Code, but offline.

  COMMANDS:
    /files [project]       List files in inbox/outbox
    /read <path>           Read a file from inbox
    /include <path>        Add a file to conversation context
    /save <path> [content] Save to outbox (or save last response)
    /project <name>        Set active project
    /model [name]          Show or switch model
    /status                Show connection and config status
    /clear                 Clear conversation history
    /help                  Show this help
    /quit                  Exit

  WORKFLOW:
    1. Export files to inbox:  .\\04_export_to_bridge.ps1 -SourcePath <file> -ProjectLabel <name>
    2. Chat here: /include MyProject/src/main.py  then ask questions
    3. Save output: /save MyProject/src/main.py
    4. Apply changes: .\\05_apply_changes.ps1 -OutboxPath <outbox> -TargetPath <project>

  TIPS:
    - Multi-line input: end a line with \\ to continue
    - Include files for context before asking about them
    - Use /save to capture code blocks from responses
"""
    print(help_text)


# ---------------------------------------------------------------------------
# Main Loop
# ---------------------------------------------------------------------------
def print_banner():
    """Print startup banner."""
    print()
    print("  +----------------------------------------------+")
    print("  |         Qwen Chat - Local AI Assistant       |")
    print("  |       Offline - Private - No Cloud - No Cost |")
    print("  +----------------------------------------------+")
    print()


def main():
    global current_project, OLLAMA_MODEL, OLLAMA_HOST

    # Parse args
    import argparse
    parser = argparse.ArgumentParser(description="Qwen Chat CLI")
    parser.add_argument("--project", "-p", help="Set active project")
    parser.add_argument("--model", "-m", help="Ollama model name", default=OLLAMA_MODEL)
    parser.add_argument("--host", help="Ollama host URL", default=OLLAMA_HOST)
    args = parser.parse_args()

    OLLAMA_MODEL = args.model
    OLLAMA_HOST = args.host
    current_project = args.project

    print_banner()

    # Pre-flight check
    model_ok, models = ollama_check()
    if not model_ok:
        print(f"  WARNING: Model '{OLLAMA_MODEL}' not found on {OLLAMA_HOST}")
        if models:
            print(f"  Available models: {', '.join(models)}")
        print(f"  Make sure Ollama is running and the model is loaded.\n")
    else:
        print(f"  Connected to {OLLAMA_HOST} - model: {OLLAMA_MODEL}")

    if current_project:
        print(f"  Active project: {current_project}")

    print(f"  Type /help for commands, /quit to exit.\n")

    while True:
        try:
            # Prompt
            prompt_prefix = f"[{current_project}]" if current_project else ""
            user_input = input(f"  {prompt_prefix}> ").strip()

            if not user_input:
                continue

            # Multi-line input (backslash continuation)
            while user_input.endswith("\\"):
                user_input = user_input[:-1] + "\n"
                continuation = input("  ... ")
                user_input += continuation

            # Slash commands
            if user_input.startswith("/"):
                if handle_command(user_input):
                    continue

            # Chat with model
            messages = build_messages(user_input)

            print()
            sys.stdout.write("  ")
            full_response = ""
            col = 2  # track column for wrapping

            for token in ollama_chat(messages):
                full_response += token
                sys.stdout.write(token)
                sys.stdout.flush()

            print("\n")

            # Update history
            conversation_history.append({"role": "user", "content": user_input})
            conversation_history.append({"role": "assistant", "content": full_response})

            # Keep history manageable (last 20 exchanges)
            if len(conversation_history) > 40:
                conversation_history[:] = conversation_history[-40:]

            # Log metadata
            log_interaction(user_input, full_response)

        except KeyboardInterrupt:
            print("\n  (Ctrl+C to exit, or type /quit)")
            continue
        except EOFError:
            print("\n  Goodbye!")
            break


if __name__ == "__main__":
    main()
