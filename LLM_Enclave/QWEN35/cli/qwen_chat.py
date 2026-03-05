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
import hashlib
import difflib
import time
import urllib.request
import urllib.error
import shutil
from pathlib import Path
from datetime import datetime
from http.server import HTTPServer, BaseHTTPRequestHandler
import threading

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
SESSIONS_DIR = ENCLAVE_ROOT / "runtime" / "sessions"

# Runtime configuration (modifiable via /config)
chat_config = {
    "temperature": 0.3,
    "num_ctx": int(os.environ.get("OLLAMA_NUM_CTX", "32768")),
    "top_p": 0.9,
    "num_predict": -1,
}

# Security: patterns that block direct file reads
DENY_PATTERNS = [
    r'\.env$', r'\.env\.', r'\.key$', r'\.pem$', r'\.secret',
    r'id_rsa', r'id_ed25519', r'\.npmrc$', r'\.pypirc$',
    r'credentials', r'\.sqlite$', r'\.db$',
    r'\.pfx$', r'\.p12$', r'\.jks$', r'\.keystore$',
]

# ---------------------------------------------------------------------------
# Globals
# ---------------------------------------------------------------------------
conversation_history = []
current_project = None
terminal_width = shutil.get_terminal_size((80, 24)).columns

# Audit log hash chain
_last_log_hash = "GENESIS"

# Response cache (LRU, 20 entries)
_response_cache = {}
_cache_order = []
MAX_CACHE = 20


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
            "num_ctx": chat_config["num_ctx"],
            "temperature": chat_config["temperature"],
            "top_p": chat_config["top_p"],
            "num_predict": chat_config["num_predict"],
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
            for line in resp:
                if line:
                    chunk = json.loads(line.decode("utf-8"))
                    token = chunk.get("message", {}).get("content", "")
                    if token:
                        yield token
                    if chunk.get("done"):
                        break
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
            found = any(OLLAMA_MODEL in m for m in models)
            return found, models
    except Exception:
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
    try:
        target.relative_to(INBOX.resolve())
    except ValueError:
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
    try:
        target.relative_to(OUTBOX.resolve())
    except ValueError:
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
# Project File Operations (Direct Read with Safety)
# ---------------------------------------------------------------------------
def read_project_file(filepath):
    """Read a file directly from a project directory with safety checks."""
    target = Path(filepath).resolve()

    # Safety: must be under PROJECTS_ROOT
    try:
        target.relative_to(PROJECTS_ROOT.resolve())
    except ValueError:
        return None, f"Access denied: path must be under {PROJECTS_ROOT}"

    # Safety: deny sensitive file patterns
    for pattern in DENY_PATTERNS:
        if re.search(pattern, str(target), re.IGNORECASE):
            return None, "Access denied: file matches security deny pattern"

    if not target.exists():
        return None, f"File not found: {filepath}"

    # Safety: size limit (1MB)
    try:
        size = target.stat().st_size
        if size > 1_048_576:
            return None, f"File too large ({size:,} bytes, max 1MB)"
    except OSError as e:
        return None, str(e)

    try:
        return target.read_text(encoding="utf-8", errors="replace"), None
    except Exception as e:
        return None, str(e)


def tree_directory(base_path, max_depth=3):
    """Generate a tree view of a directory up to max_depth levels."""
    base = Path(base_path).resolve()
    try:
        base.relative_to(PROJECTS_ROOT.resolve())
    except ValueError:
        return f"Access denied: path must be under {PROJECTS_ROOT}"

    if not base.exists():
        return f"Directory not found: {base_path}"

    lines = [str(base)]
    _tree_walk(base, "", max_depth, 0, lines)
    return "\n".join(lines)


def _tree_walk(directory, prefix, max_depth, current_depth, lines):
    """Recursive helper for tree display."""
    if current_depth >= max_depth:
        return
    try:
        entries = sorted(directory.iterdir(), key=lambda e: (not e.is_dir(), e.name.lower()))
    except PermissionError:
        lines.append(f"{prefix}[permission denied]")
        return

    # Limit entries per level
    display_entries = entries[:50]
    hidden = len(entries) - len(display_entries)

    for i, entry in enumerate(display_entries):
        is_last = (i == len(display_entries) - 1) and hidden == 0
        connector = "`-- " if is_last else "|-- "
        if entry.is_dir():
            lines.append(f"{prefix}{connector}{entry.name}/")
            extension = "    " if is_last else "|   "
            _tree_walk(entry, prefix + extension, max_depth, current_depth + 1, lines)
        else:
            lines.append(f"{prefix}{connector}{entry.name}")

    if hidden > 0:
        lines.append(f"{prefix}`-- ... and {hidden} more")


def find_files(pattern, base_path):
    """Find files matching a glob pattern under base_path."""
    base = Path(base_path).resolve()
    try:
        base.relative_to(PROJECTS_ROOT.resolve())
    except ValueError:
        return [], f"Access denied: path must be under {PROJECTS_ROOT}"

    if not base.exists():
        return [], f"Directory not found: {base_path}"

    results = []
    try:
        for f in base.rglob(pattern):
            if f.is_file():
                results.append(str(f.relative_to(base)))
                if len(results) >= 50:
                    break
    except Exception as e:
        return [], str(e)

    return results, None


def extract_code_blocks(text):
    """Extract fenced code blocks from markdown text."""
    pattern = r'```(\w*)\n(.*?)```'
    return re.findall(pattern, text, re.DOTALL)


# ---------------------------------------------------------------------------
# Session Management
# ---------------------------------------------------------------------------
def save_session(name=None):
    """Save current conversation to a session file."""
    SESSIONS_DIR.mkdir(parents=True, exist_ok=True)
    if not name:
        name = datetime.now().strftime("session_%Y%m%d_%H%M%S")
    session_data = {
        "name": name,
        "timestamp": datetime.now().isoformat(),
        "model": OLLAMA_MODEL,
        "project": current_project,
        "history": conversation_history,
    }
    path = SESSIONS_DIR / f"{name}.json"
    path.write_text(json.dumps(session_data, indent=2), encoding="utf-8")
    return str(path)


def load_session(name):
    """Load a conversation session by name."""
    path = SESSIONS_DIR / f"{name}.json"
    if not path.exists():
        return None, f"Session not found: {name}"
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data, None
    except Exception as e:
        return None, str(e)


def list_sessions():
    """List available session files."""
    if not SESSIONS_DIR.exists():
        return []
    sessions = []
    for f in sorted(SESSIONS_DIR.glob("*.json"), reverse=True):
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
            sessions.append({
                "name": f.stem,
                "timestamp": data.get("timestamp", "?"),
                "model": data.get("model", "?"),
                "project": data.get("project", ""),
                "messages": len(data.get("history", [])),
            })
        except Exception:
            sessions.append({"name": f.stem, "timestamp": "?", "messages": 0})
    return sessions


# ---------------------------------------------------------------------------
# Logging (with hash-chain for tamper detection)
# ---------------------------------------------------------------------------
def log_interaction(user_msg, assistant_msg):
    """Log interaction metadata (not content) with hash chain."""
    global _last_log_hash
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    log_file = LOG_DIR / f"session_{datetime.now().strftime('%Y%m%d')}.log"
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    entry_data = f"{timestamp}|user_len={len(user_msg)}|assistant_len={len(assistant_msg)}|model={OLLAMA_MODEL}|prev={_last_log_hash}"
    entry_hash = hashlib.sha256(entry_data.encode()).hexdigest()[:16]
    entry = f"{entry_data}|hash={entry_hash}\n"
    _last_log_hash = entry_hash
    with open(log_file, "a", encoding="utf-8") as f:
        f.write(entry)


# ---------------------------------------------------------------------------
# Markdown Rendering (basic ANSI terminal)
# ---------------------------------------------------------------------------
def render_markdown(text):
    """Apply basic ANSI markdown rendering for terminal display."""
    lines = text.split("\n")
    rendered = []
    in_code_block = False

    for line in lines:
        # Code block toggle
        if line.strip().startswith("```"):
            if not in_code_block:
                lang = line.strip()[3:].strip()
                rendered.append(f"\033[2m  --- {lang or 'code'} ---\033[0m")
                in_code_block = True
            else:
                rendered.append("\033[2m  --- end ---\033[0m")
                in_code_block = False
            continue

        if in_code_block:
            rendered.append(f"\033[36m  {line}\033[0m")
            continue

        # Headers
        if line.startswith("### "):
            rendered.append(f"\033[1m{line[4:]}\033[0m")
        elif line.startswith("## "):
            rendered.append(f"\033[1m{line[3:]}\033[0m")
        elif line.startswith("# "):
            rendered.append(f"\033[1m{line[2:]}\033[0m")
        else:
            # Inline code
            line = re.sub(r'`([^`]+)`', r'\033[36m\1\033[0m', line)
            # Bold
            line = re.sub(r'\*\*([^*]+)\*\*', r'\033[1m\1\033[0m', line)
            rendered.append(line)

    return "\n".join(rendered)


# ---------------------------------------------------------------------------
# Token Estimation & Cache
# ---------------------------------------------------------------------------
def estimate_tokens(text):
    """Rough token estimate: ~4 chars per token for English."""
    return max(1, len(text) // 4)


def get_cache_key(messages):
    """SHA256 of message payload for caching."""
    key_data = json.dumps(messages, sort_keys=True)
    return hashlib.sha256(key_data.encode()).hexdigest()


# ---------------------------------------------------------------------------
# Health Endpoint (daemon thread)
# ---------------------------------------------------------------------------
class _HealthHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path != "/health":
            self.send_response(404)
            self.end_headers()
            return
        status = {"ollama": False, "model": OLLAMA_MODEL, "project": current_project}
        try:
            with urllib.request.urlopen(f"{OLLAMA_HOST}/api/tags", timeout=3) as resp:
                data = json.loads(resp.read())
                status["ollama"] = True
                status["models"] = [m["name"] for m in data.get("models", [])]
        except Exception:
            pass
        status["history_messages"] = len(conversation_history)
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(status).encode())

    def log_message(self, format, *args):
        pass  # Suppress access logs


def start_health_server(port=11435):
    """Start health endpoint on localhost in a daemon thread."""
    try:
        server = HTTPServer(("127.0.0.1", port), _HealthHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        return port
    except OSError:
        return None  # Port in use, skip silently


# ---------------------------------------------------------------------------
# System Prompt
# ---------------------------------------------------------------------------
SYSTEM_PROMPT_BASE = """You are Qwen, a local AI coding assistant running inside a secure LLM Enclave.

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


def build_system_prompt():
    """Build system prompt, optionally enhanced with project context."""
    prompt = SYSTEM_PROMPT_BASE
    if current_project:
        project_dir = PROJECTS_ROOT / current_project
        prompt += f"\n\nACTIVE PROJECT: {current_project}"
        prompt += f"\nProject directory: {project_dir}"

        # Auto-include CLAUDE.md if it exists
        claude_md = project_dir / "CLAUDE.md"
        if claude_md.exists():
            try:
                content = claude_md.read_text(encoding="utf-8", errors="replace")[:2000]
                prompt += f"\n\nProject instructions (from CLAUDE.md):\n{content}"
            except Exception:
                pass
        else:
            # Fallback to README.md
            readme = project_dir / "README.md"
            if readme.exists():
                try:
                    content = readme.read_text(encoding="utf-8", errors="replace")[:1000]
                    prompt += f"\n\nProject README (truncated):\n{content}"
                except Exception:
                    pass
    return prompt


def build_messages(user_input):
    """Build the message list for the Ollama API."""
    messages = [{"role": "system", "content": build_system_prompt()}]
    messages.extend(conversation_history)
    messages.append({"role": "user", "content": user_input})
    return messages


# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------
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

    elif command in ("/read-project", "/rp"):
        if not arg:
            print("  Usage: /read-project <absolute-path-or-relative-to-project>")
            print("  Reads files directly from project directories.")
            return True
        # If relative and project is set, resolve against project root
        filepath = arg
        if not Path(arg).is_absolute() and current_project:
            filepath = str(PROJECTS_ROOT / current_project / arg)
        content, err = read_project_file(filepath)
        if err:
            print(f"  Error: {err}")
        else:
            print(f"\n  --- {arg} ---")
            print(content)
            print(f"  --- end ({len(content):,} chars) ---\n")
        return True

    elif command == "/tree":
        base = arg
        if not base and current_project:
            base = str(PROJECTS_ROOT / current_project)
        elif not base:
            base = str(PROJECTS_ROOT)
        result = tree_directory(base)
        print(f"\n{result}\n")
        return True

    elif command == "/find":
        if not arg:
            print("  Usage: /find <glob-pattern> [path]")
            return True
        find_parts = arg.split(maxsplit=1)
        pattern = find_parts[0]
        base = find_parts[1] if len(find_parts) > 1 else None
        if not base and current_project:
            base = str(PROJECTS_ROOT / current_project)
        elif not base:
            base = str(PROJECTS_ROOT)
        results, err = find_files(pattern, base)
        if err:
            print(f"  Error: {err}")
        elif results:
            print(f"\n  Found {len(results)} file(s):")
            for r in results:
                print(f"    {r}")
            if len(results) >= 50:
                print("    ... (limited to 50 results)")
            print()
        else:
            print("  No files found.")
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
        print(f"  Added {arg} to context ({len(content):,} chars)")
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

    elif command == "/extract":
        if not conversation_history or conversation_history[-1]["role"] != "assistant":
            print("  No assistant response to extract from.")
            return True
        last_response = conversation_history[-1]["content"]
        blocks = extract_code_blocks(last_response)
        if not blocks:
            print("  No code blocks found in last response.")
            return True
        ext_map = {
            "python": ".py", "py": ".py", "javascript": ".js", "js": ".js",
            "typescript": ".ts", "ts": ".ts", "html": ".html", "css": ".css",
            "json": ".json", "yaml": ".yaml", "yml": ".yaml", "bash": ".sh",
            "sh": ".sh", "powershell": ".ps1", "ps1": ".ps1", "sql": ".sql",
            "rust": ".rs", "go": ".go", "java": ".java", "c": ".c", "cpp": ".cpp",
        }
        for i, (lang, code) in enumerate(blocks):
            if arg:
                if len(blocks) == 1:
                    filename = arg
                else:
                    stem = Path(arg).stem
                    suffix = Path(arg).suffix
                    filename = f"{stem}_{i}{suffix}"
            else:
                ext = ext_map.get(lang.lower(), ".txt")
                filename = f"extract_{i}{ext}"
            project_prefix = f"{current_project}/" if current_project else ""
            err = write_outbox_file(f"{project_prefix}{filename}", code.strip())
            if err:
                print(f"  Error saving {filename}: {err}")
            else:
                print(f"  Saved: outbox/{project_prefix}{filename} ({lang or 'unknown'}, {len(code):,} chars)")
        return True

    elif command == "/diff":
        if not arg:
            print("  Usage: /diff <outbox-file> <project-file>")
            print("  Shows unified diff between outbox file and project file.")
            return True
        diff_parts = arg.split(maxsplit=1)
        if len(diff_parts) < 2:
            print("  Usage: /diff <outbox-file> <project-file>")
            return True
        outbox_path = diff_parts[0]
        project_path = diff_parts[1]
        # Read outbox file
        outbox_content, err1 = None, None
        outbox_target = (OUTBOX / outbox_path).resolve()
        try:
            outbox_target.relative_to(OUTBOX.resolve())
            if outbox_target.exists():
                outbox_content = outbox_target.read_text(encoding="utf-8", errors="replace")
            else:
                err1 = f"Outbox file not found: {outbox_path}"
        except ValueError:
            err1 = "Access denied: path outside outbox"
        if err1:
            print(f"  Error: {err1}")
            return True
        # Read project file
        project_content, err2 = read_project_file(project_path)
        if err2:
            print(f"  Error: {err2}")
            return True
        # Generate diff
        old_lines = project_content.splitlines(keepends=True)
        new_lines = outbox_content.splitlines(keepends=True)
        diff = list(difflib.unified_diff(old_lines, new_lines,
                                          fromfile=project_path, tofile=outbox_path))
        if not diff:
            print("  Files are identical.")
        else:
            print()
            for line in diff:
                line = line.rstrip("\n")
                if line.startswith("+"):
                    print(f"  \033[32m{line}\033[0m")
                elif line.startswith("-"):
                    print(f"  \033[31m{line}\033[0m")
                elif line.startswith("@@"):
                    print(f"  \033[36m{line}\033[0m")
                else:
                    print(f"  {line}")
            print()
        return True

    elif command == "/project":
        if arg:
            current_project = arg
            # Check if project dir exists
            project_dir = PROJECTS_ROOT / current_project
            if project_dir.exists():
                print(f"  Active project: {current_project}")
                claude_md = project_dir / "CLAUDE.md"
                if claude_md.exists():
                    print(f"  CLAUDE.md found - will be included in system prompt.")
            else:
                print(f"  Active project: {current_project} (directory not found)")
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

    elif command == "/config":
        if not arg:
            print("  Current configuration:")
            for k, v in chat_config.items():
                print(f"    {k} = {v}")
            print("\n  Usage: /config <key> <value>")
            print(f"  Keys: {', '.join(chat_config.keys())}")
            return True
        config_parts = arg.split(maxsplit=1)
        key = config_parts[0]
        if key not in chat_config:
            print(f"  Unknown config key: {key}")
            print(f"  Available: {', '.join(chat_config.keys())}")
            return True
        if len(config_parts) < 2:
            print(f"  {key} = {chat_config[key]}")
            return True
        try:
            val_str = config_parts[1]
            if "." in val_str:
                chat_config[key] = float(val_str)
            else:
                chat_config[key] = int(val_str)
            print(f"  {key} = {chat_config[key]}")
        except ValueError:
            print(f"  Invalid value: {config_parts[1]}")
        return True

    elif command in ("/save-session", "/ss"):
        name = arg or None
        path = save_session(name)
        print(f"  Session saved: {path}")
        print("  WARNING: Session files contain conversation history.")
        return True

    elif command in ("/load-session", "/ls-load"):
        if not arg:
            print("  Usage: /load-session <name>")
            return True
        data, err = load_session(arg)
        if err:
            print(f"  Error: {err}")
            return True
        conversation_history.clear()
        conversation_history.extend(data.get("history", []))
        loaded_project = data.get("project")
        if loaded_project:
            current_project = loaded_project
        print(f"  Loaded session: {arg} ({len(conversation_history)} messages)")
        if loaded_project:
            print(f"  Restored project: {loaded_project}")
        return True

    elif command in ("/list-sessions", "/sessions"):
        sessions = list_sessions()
        if not sessions:
            print("  No saved sessions.")
            return True
        print(f"\n  Saved sessions ({len(sessions)}):")
        for s in sessions[:20]:
            proj = f" [{s.get('project', '')}]" if s.get('project') else ""
            print(f"    {s['name']}  {s.get('timestamp', '?')}  ({s.get('messages', 0)} msgs){proj}")
        print()
        return True

    elif command == "/purge-inbox":
        project = arg or current_project
        target_dir = INBOX / project if project else INBOX
        if not target_dir.exists():
            print(f"  Inbox path does not exist: {target_dir}")
            return True
        file_count = sum(1 for f in target_dir.rglob("*") if f.is_file())
        print(f"  This will delete {file_count} file(s) from: {target_dir}")
        confirm = input("  Type 'PURGE' to confirm: ").strip()
        if confirm != "PURGE":
            print("  Cancelled.")
            return True
        shutil.rmtree(target_dir)
        target_dir.mkdir(parents=True, exist_ok=True)
        print(f"  Purged {file_count} files from inbox.")
        return True

    elif command in ("/status", "/info"):
        model_ok, models = ollama_check()
        ctx_tokens = sum(estimate_tokens(m["content"]) for m in conversation_history)
        sys_tokens = estimate_tokens(build_system_prompt())
        print(f"\n  Ollama:    {OLLAMA_HOST}")
        print(f"  Model:     {OLLAMA_MODEL} ({'available' if model_ok else 'NOT FOUND'})")
        print(f"  Models:    {', '.join(models) if models else '(none)'}")
        print(f"  Project:   {current_project or '(none)'}")
        print(f"  Inbox:     {INBOX}")
        print(f"  Outbox:    {OUTBOX}")
        print(f"  History:   {len(conversation_history)} messages (~{ctx_tokens} tokens)")
        print(f"  System:    ~{sys_tokens} tokens")
        print(f"  Context:   {chat_config['num_ctx']} max tokens")
        print(f"  Temp:      {chat_config['temperature']}  Top-P: {chat_config['top_p']}")
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

  FILE COMMANDS:
    /files [project]       List files in inbox/outbox
    /read <path>           Read a file from inbox
    /read-project <path>   Read a file directly from project directory
    /include <path>        Add an inbox file to conversation context
    /save <path> [content] Save to outbox (or save last response)
    /extract [filename]    Extract code blocks from last response to outbox
    /diff <out> <proj>     Show diff between outbox and project file

  EXPLORATION:
    /tree [path]           Show directory tree (3 levels deep)
    /find <pattern> [path] Find files by glob pattern

  SESSION:
    /save-session [name]   Save conversation to a session file
    /load-session <name>   Load a saved session
    /list-sessions         List saved sessions

  SETTINGS:
    /project <name>        Set active project (auto-loads CLAUDE.md)
    /model [name]          Show or switch model
    /config [key] [value]  Show or adjust runtime parameters
    /status                Show connection, config, and token status
    /clear                 Clear conversation history
    /purge-inbox [project] Delete all files from inbox (requires typed confirm)

  GENERAL:
    /help                  Show this help
    /quit                  Exit

  WORKFLOW:
    1. Set project: /project MyProject
    2. Read files:  /read-project src/main.py  (or /include from inbox)
    3. Chat:        ask questions about the code
    4. Save output: /save MyProject/src/main.py (or /extract for code blocks)
    5. Apply:       .\\05_apply_changes.ps1 -OutboxPath <outbox> -TargetPath <project>

  TIPS:
    - Multi-line input: end a line with \\ to continue
    - /read-project reads directly from project dirs (no export needed)
    - /extract pulls code blocks from AI responses as files
    - /config to adjust temperature, context window, etc.
    - /save-session to save & resume conversations later
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

    # Start health endpoint (background, non-critical)
    health_port = start_health_server()
    if health_port:
        print(f"  Health endpoint: http://127.0.0.1:{health_port}/health")

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
        project_dir = PROJECTS_ROOT / current_project
        if (project_dir / "CLAUDE.md").exists():
            print(f"  CLAUDE.md loaded into system prompt.")

    print(f"  Context window: {chat_config['num_ctx']} tokens")
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

            # Check response cache
            cache_key = get_cache_key(messages)
            if cache_key in _response_cache:
                print("\n  \033[2m[cached]\033[0m")
                full_response = _response_cache[cache_key]
                rendered = render_markdown(full_response)
                for line in rendered.split("\n"):
                    print(f"  {line}")
                print()
            else:
                # Stream response
                print()
                sys.stdout.write("  ")
                full_response = ""
                start_time = time.time()

                for token in ollama_chat(messages):
                    full_response += token
                    sys.stdout.write(token)
                    sys.stdout.flush()

                elapsed = time.time() - start_time
                resp_tokens = estimate_tokens(full_response)
                tps = resp_tokens / elapsed if elapsed > 0 else 0

                print(f"\n  \033[2m[{elapsed:.1f}s | ~{resp_tokens} tok | {tps:.0f} tok/s]\033[0m\n")

                # Cache the response
                _response_cache[cache_key] = full_response
                _cache_order.append(cache_key)
                if len(_cache_order) > MAX_CACHE:
                    old_key = _cache_order.pop(0)
                    _response_cache.pop(old_key, None)

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
