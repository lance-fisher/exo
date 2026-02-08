#!/usr/bin/env python3
"""
ProjectsHome Hub - Centralized Project Dashboard
Single-file Python HTTP server serving a full SPA with project cards,
search, filters, bot integration, and cross-platform project management.

Runs at http://localhost:8090 by default.

Usage:
    python server.py
    python server.py --port 8090
    python server.py --root D:\\ProjectsHome
"""

import http.server
import json
import os
import re
import sys
import uuid
import time
import subprocess
import threading
import urllib.request
import urllib.error
from pathlib import Path
from datetime import datetime, timezone
from urllib.parse import urlparse, parse_qs
import socketserver

PORT = int(os.environ.get("PORT", 8090))
PROJECTS_ROOT = os.environ.get("PROJECTS_ROOT", str(Path(__file__).parent.parent.resolve()))
DATA_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "projects.json")
MESSAGES_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "messages.json")
CONFIG_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "config.json")

OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://localhost:11434")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "qwen2.5-coder:14b")


# ─── Data Layer ──────────────────────────────────────────────────────────────

def load_json(filepath, default=None):
    if default is None:
        default = {}
    try:
        with open(filepath, "r", encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def save_json(filepath, data):
    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, default=str)


def load_projects():
    return load_json(DATA_FILE, {"projects": {}, "sessions": {}})


def save_projects(data):
    save_json(DATA_FILE, data)


def load_messages():
    return load_json(MESSAGES_FILE, {"messages": []})


def save_messages(data):
    save_json(MESSAGES_FILE, data)


def load_config():
    return load_json(CONFIG_FILE, {
        "projects_root": PROJECTS_ROOT,
        "port": PORT,
        "github": {"enabled": False, "username": "lance-fisher"},
        "bot": {"provider": "ollama", "model": OLLAMA_MODEL, "base_url": OLLAMA_URL},
    })


# ─── Project Scanner ─────────────────────────────────────────────────────────

def scan_directory(root_path):
    """Scan a directory for projects and extract metadata."""
    root = Path(root_path)
    if not root.exists():
        return []

    projects = []
    ignore = {"node_modules", ".git", "__pycache__", "dist", "build", ".venv", ".dca-backups"}

    for entry in sorted(root.iterdir()):
        if not entry.is_dir() or entry.name.startswith(".") or entry.name in ignore:
            continue
        meta = extract_project_metadata(entry)
        if meta:
            projects.append(meta)

    return projects


def extract_project_metadata(project_dir):
    """Extract metadata from a project directory."""
    p = Path(project_dir)
    meta = {
        "id": str(uuid.uuid5(uuid.NAMESPACE_URL, str(p))),
        "name": p.name.replace("-", " ").replace("_", " ").title(),
        "description": "",
        "status": "active",
        "platform": "PC",
        "tags": [],
        "path": str(p),
        "created": datetime.fromtimestamp(p.stat().st_ctime).strftime("%Y-%m-%d"),
        "updated": datetime.fromtimestamp(p.stat().st_mtime).strftime("%Y-%m-%d"),
    }

    # Read project-hub.json or .project.json
    for cfg_name in ["project-hub.json", ".project.json"]:
        cfg_path = p / cfg_name
        if cfg_path.exists():
            try:
                with open(cfg_path, "r", encoding="utf-8") as f:
                    cfg = json.load(f)
                meta.update(cfg)
                meta["path"] = str(p)  # Always use actual path
                if "id" not in cfg:
                    meta["id"] = str(uuid.uuid5(uuid.NAMESPACE_URL, str(p)))
                return meta
            except (json.JSONDecodeError, IOError):
                pass

    # Read package.json
    pkg_path = p / "package.json"
    if pkg_path.exists():
        try:
            with open(pkg_path, "r", encoding="utf-8") as f:
                pkg = json.load(f)
            if pkg.get("name") and not pkg["name"].startswith("@"):
                meta["name"] = pkg["name"].replace("-", " ").title()
            if pkg.get("description"):
                meta["description"] = pkg["description"][:300]
            meta["tags"].append("node")
        except (json.JSONDecodeError, IOError):
            pass

    # Read setup.py / pyproject.toml
    if (p / "setup.py").exists() or (p / "pyproject.toml").exists():
        meta["tags"].append("python")
    if (p / "requirements.txt").exists():
        meta["tags"].append("python")

    # Read README
    for readme_name in ["README.md", "readme.md", "README.txt", "README"]:
        readme_path = p / readme_name
        if readme_path.exists():
            try:
                with open(readme_path, "r", encoding="utf-8") as f:
                    content = f.read(3000)
                heading = re.search(r"^#\s+(.+)", content, re.MULTILINE)
                if heading:
                    meta["name"] = heading.group(1).strip()[:80]
                paragraphs = re.findall(r"\n\n(.+?)(?:\n\n|\Z)", content, re.DOTALL)
                if paragraphs and not meta["description"]:
                    meta["description"] = re.sub(r"\s+", " ", paragraphs[0].strip())[:300]
                break
            except IOError:
                pass

    # Read .git for repo info
    git_config = p / ".git" / "config"
    if git_config.exists():
        try:
            with open(git_config, "r", encoding="utf-8") as f:
                git_content = f.read()
            url_match = re.search(r"url\s*=\s*(.+)", git_content)
            if url_match:
                meta["repo"] = url_match.group(1).strip()
        except IOError:
            pass

    # Detect platform
    if any((p / f).exists() for f in ["Podfile", "Info.plist"]):
        meta["platform"] = "IOS"
    for ext in ["*.xcodeproj", "*.xcworkspace"]:
        if list(p.glob(ext)):
            meta["platform"] = "IOS"

    # Detect docker
    if (p / "docker-compose.yml").exists() or (p / "Dockerfile").exists():
        meta["tags"].append("docker")

    return meta


def check_bot_status():
    """Check if the local Ollama bot is online."""
    try:
        req = urllib.request.Request(f"{OLLAMA_URL}/api/tags", method="GET")
        resp = urllib.request.urlopen(req, timeout=3)
        data = json.loads(resp.read())
        models = [m.get("name", "") for m in data.get("models", [])]
        has_model = any(OLLAMA_MODEL.split(":")[0] in m for m in models)
        return {"online": True, "model": OLLAMA_MODEL, "available_models": models, "model_loaded": has_model}
    except Exception:
        return {"online": False, "model": OLLAMA_MODEL}


def send_bot_message(prompt, context=""):
    """Send a message to the local Ollama bot."""
    try:
        payload = {
            "model": OLLAMA_MODEL,
            "prompt": prompt,
            "system": f"You are a helpful coding assistant in ProjectsHome Hub. {context}",
            "stream": False,
        }
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            f"{OLLAMA_URL}/api/generate",
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        resp = urllib.request.urlopen(req, timeout=120)
        result = json.loads(resp.read())
        return result.get("response", "No response from model.")
    except Exception as e:
        return f"Bot error: {str(e)}"


# ─── HTTP Handler ─────────────────────────────────────────────────────────────

class HubHandler(http.server.BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        print(f"[hub] {args[0]}" if args else "")

    def send_json(self, data, status=200):
        body = json.dumps(data, default=str).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_html(self, html, status=200):
        body = html.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_body(self):
        length = int(self.headers.get("Content-Length", 0))
        if length == 0:
            return {}
        raw = self.rfile.read(length)
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return {}

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/")

        if path == "" or path == "/":
            self.send_html(SPA_HTML)
        elif path == "/api/projects":
            self.handle_list_projects()
        elif path.startswith("/api/projects/") and len(path.split("/")) == 4:
            self.handle_get_project(path.split("/")[3])
        elif path == "/api/stats":
            self.handle_stats()
        elif path == "/api/bot/status":
            self.send_json(check_bot_status())
        elif path == "/api/messages":
            self.handle_get_messages()
        elif path == "/api/config":
            self.send_json(load_config())
        else:
            self.send_json({"error": "Not found"}, 404)

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/")

        if path == "/api/projects":
            self.handle_add_project()
        elif path == "/api/projects/scan":
            self.handle_scan()
        elif path == "/api/messages":
            self.handle_send_message()
        elif path == "/api/bot/chat":
            self.handle_bot_chat()
        else:
            self.send_json({"error": "Not found"}, 404)

    def do_PUT(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/")

        if path.startswith("/api/projects/") and len(path.split("/")) == 4:
            self.handle_update_project(path.split("/")[3])
        else:
            self.send_json({"error": "Not found"}, 404)

    # ── Handlers ──

    def handle_list_projects(self):
        store = load_projects()
        projects = sorted(store.get("projects", {}).values(), key=lambda p: p.get("updated", ""), reverse=True)
        self.send_json({"projects": projects, "total": len(projects)})

    def handle_get_project(self, pid):
        store = load_projects()
        project = store.get("projects", {}).get(pid)
        if project:
            self.send_json(project)
        else:
            self.send_json({"error": "Not found"}, 404)

    def handle_add_project(self):
        data = self.read_body()
        store = load_projects()
        pid = data.get("id", str(uuid.uuid4()))
        data["id"] = pid
        data.setdefault("created", datetime.now().strftime("%Y-%m-%d"))
        data["updated"] = datetime.now().strftime("%Y-%m-%d")
        store.setdefault("projects", {})[pid] = data
        save_projects(store)
        self.send_json({"message": "Project added", "id": pid, "project": data})

    def handle_update_project(self, pid):
        data = self.read_body()
        store = load_projects()
        if pid not in store.get("projects", {}):
            self.send_json({"error": "Not found"}, 404)
            return
        store["projects"][pid].update(data)
        store["projects"][pid]["updated"] = datetime.now().strftime("%Y-%m-%d")
        save_projects(store)
        self.send_json({"message": "Updated", "project": store["projects"][pid]})

    def handle_scan(self):
        config = load_config()
        root = config.get("projects_root", PROJECTS_ROOT)
        scanned = scan_directory(root)
        store = load_projects()
        added = 0
        updated = 0
        for proj in scanned:
            pid = proj["id"]
            if pid in store.get("projects", {}):
                store["projects"][pid].update(proj)
                updated += 1
            else:
                store.setdefault("projects", {})[pid] = proj
                added += 1
        save_projects(store)
        self.send_json({"message": f"Scan complete. {added} added, {updated} updated.", "total": len(scanned)})

    def handle_stats(self):
        store = load_projects()
        msgs = load_messages()
        projects = list(store.get("projects", {}).values())
        active = sum(1 for p in projects if p.get("status") in ("active", "in progress"))
        sessions = len(store.get("sessions", {}))
        self.send_json({
            "total_projects": len(projects),
            "active": active,
            "sessions": sessions,
            "messages": len(msgs.get("messages", [])),
        })

    def handle_get_messages(self):
        msgs = load_messages()
        self.send_json(msgs)

    def handle_send_message(self):
        data = self.read_body()
        msgs = load_messages()
        msg = {
            "id": str(uuid.uuid4()),
            "role": data.get("role", "user"),
            "content": data.get("content", ""),
            "project_id": data.get("project_id"),
            "timestamp": datetime.now().isoformat(),
        }
        msgs.setdefault("messages", []).append(msg)
        save_messages(msgs)
        self.send_json({"message": "Sent", "msg": msg})

    def handle_bot_chat(self):
        data = self.read_body()
        prompt = data.get("prompt", "")
        context = data.get("context", "")
        if not prompt:
            self.send_json({"error": "No prompt"}, 400)
            return

        # Save user message
        msgs = load_messages()
        user_msg = {
            "id": str(uuid.uuid4()),
            "role": "user",
            "content": prompt,
            "timestamp": datetime.now().isoformat(),
        }
        msgs.setdefault("messages", []).append(user_msg)

        # Get bot response
        response = send_bot_message(prompt, context)

        bot_msg = {
            "id": str(uuid.uuid4()),
            "role": "assistant",
            "content": response,
            "timestamp": datetime.now().isoformat(),
        }
        msgs["messages"].append(bot_msg)
        save_messages(msgs)

        self.send_json({"response": response, "message": bot_msg})


# ─── SPA HTML ─────────────────────────────────────────────────────────────────

SPA_HTML = r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>ProjectsHome Hub</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#0f0f1a;--bg2:#1a1a2e;--bg3:#232340;--bg4:#2d2d4a;
  --text:#e0e0e8;--text2:#a0a0b8;--text3:#707088;
  --accent:#00d4aa;--accent2:#00b894;--accent3:#0984e3;
  --green:#00b894;--blue:#0984e3;--yellow:#fdcb6e;--red:#d63031;--purple:#6c5ce7;
  --radius:10px;--shadow:0 2px 12px rgba(0,0,0,0.3);
}
html{font-size:15px}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:var(--bg);color:var(--text);min-height:100vh;line-height:1.5}
a{color:var(--accent);text-decoration:none}
button{cursor:pointer;border:none;font-family:inherit;font-size:inherit}
input,textarea{font-family:inherit;font-size:inherit}
*:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);border:0}

/* Header */
.header{background:var(--bg2);border-bottom:1px solid var(--bg3);padding:14px 24px;display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}
.header-left{display:flex;align-items:center;gap:16px}
.logo{font-size:1.4rem;font-weight:700;color:var(--accent)}
.logo span{color:var(--text2);font-weight:400;font-size:1rem}
.stats{display:flex;gap:16px;font-size:.8rem;color:var(--text2)}
.stats b{color:var(--text);margin-right:2px}
.header-right{display:flex;align-items:center;gap:10px}
.bot-status{display:flex;align-items:center;gap:6px;font-size:.8rem;padding:6px 12px;background:var(--bg3);border-radius:6px;color:var(--text2)}
.bot-dot{width:8px;height:8px;border-radius:50%}
.bot-dot.on{background:var(--green)}
.bot-dot.off{background:var(--red)}
.btn{padding:8px 16px;border-radius:6px;font-size:.85rem;font-weight:500;transition:all .15s}
.btn-outline{background:transparent;border:1px solid var(--bg4);color:var(--text2)}
.btn-outline:hover{border-color:var(--accent);color:var(--accent)}
.btn-primary{background:var(--accent);color:#000;border:none;font-weight:600}
.btn-primary:hover{background:var(--accent2)}

/* Tabs */
.tabs-bar{background:var(--bg2);padding:0 24px;display:flex;align-items:center;gap:0;border-bottom:1px solid var(--bg3)}
.tab{padding:10px 20px;font-size:.9rem;color:var(--text2);background:transparent;border-bottom:2px solid transparent;transition:all .15s}
.tab:hover{color:var(--text)}
.tab.active{color:var(--accent);border-bottom-color:var(--accent)}

/* Task input */
.task-bar{background:var(--bg2);padding:12px 24px;border-bottom:1px solid var(--bg3);display:flex;align-items:center;gap:12px}
.task-icon{font-size:1.2rem}
.task-input{flex:1;background:transparent;border:none;color:var(--text);font-size:.95rem;outline:none}
.task-input::placeholder{color:var(--text3)}
.task-hint{font-size:.75rem;color:var(--text3);white-space:nowrap}

/* Toolbar */
.toolbar{padding:14px 24px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.search-box{background:var(--bg2);border:1px solid var(--bg3);border-radius:8px;padding:8px 14px;color:var(--text);width:280px;font-size:.85rem}
.search-box::placeholder{color:var(--text3)}
.filters{display:flex;align-items:center;gap:6px}
.filter-btn{padding:5px 14px;border-radius:6px;font-size:.8rem;color:var(--text2);background:transparent;border:1px solid transparent;transition:all .15s}
.filter-btn:hover{color:var(--text)}
.filter-btn.active{background:var(--bg3);color:var(--text);border-color:var(--bg4)}
.view-toggle{display:flex;gap:4px}
.view-btn{padding:6px 10px;border-radius:6px;background:transparent;color:var(--text3);font-size:.9rem}
.view-btn.active{background:var(--bg3);color:var(--text)}

/* Grid */
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:16px;padding:0 24px 24px}

/* Cards */
.card{background:var(--bg2);border:1px solid var(--bg3);border-radius:var(--radius);padding:18px;transition:all .2s;cursor:pointer;display:flex;flex-direction:column;gap:10px}
.card:hover{border-color:var(--bg4);box-shadow:var(--shadow);transform:translateY(-1px)}
.card-title{font-size:1.05rem;font-weight:600;color:var(--text);line-height:1.3}
.card-desc{font-size:.85rem;color:var(--text2);line-height:1.5;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.card-footer{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:auto}
.card-meta{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.badge{padding:2px 8px;border-radius:4px;font-size:.7rem;font-weight:600;text-transform:uppercase;letter-spacing:.03em}
.badge-active{background:rgba(0,184,148,.15);color:var(--green)}
.badge-completed{background:rgba(0,184,148,.15);color:var(--green)}
.badge-concept{background:rgba(9,132,227,.15);color:var(--blue)}
.badge-progress{background:rgba(253,203,110,.15);color:var(--yellow)}
.badge-idea{background:rgba(108,92,231,.15);color:var(--purple)}
.platform-tag{display:flex;align-items:center;gap:4px;font-size:.7rem;color:var(--blue);font-weight:500}
.platform-tag svg{width:14px;height:14px}
.card-time{font-size:.75rem;color:var(--text3)}
.card-path{display:flex;align-items:center;gap:6px;background:var(--bg);border-radius:6px;padding:6px 10px;font-size:.75rem;color:var(--text3);font-family:'Cascadia Code','Fira Code',monospace}
.card-path span{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.copy-btn{background:transparent;color:var(--text3);font-size:.75rem;padding:2px;border-radius:3px}
.copy-btn:hover{color:var(--text)}
.card-actions{display:flex;gap:6px;flex-wrap:wrap}
.action-btn{padding:4px 12px;border-radius:5px;font-size:.75rem;font-weight:500;background:var(--bg);color:var(--accent);border:1px solid var(--bg3);display:flex;align-items:center;gap:4px;transition:all .15s}
.action-btn:hover{background:var(--bg3);border-color:var(--accent)}
.action-btn .icon{font-size:.7rem}

/* Empty state */
.empty{text-align:center;padding:60px 24px;color:var(--text3)}
.empty h3{font-size:1.2rem;margin-bottom:8px;color:var(--text2)}

/* Modal */
.modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;z-index:100;opacity:0;pointer-events:none;transition:opacity .2s}
.modal-overlay.open{opacity:1;pointer-events:all}
.modal{background:var(--bg2);border:1px solid var(--bg3);border-radius:12px;padding:24px;width:90%;max-width:500px;box-shadow:0 8px 32px rgba(0,0,0,.5)}
.modal h2{margin-bottom:16px;font-size:1.1rem}
.modal label{display:block;margin-bottom:4px;font-size:.85rem;color:var(--text2)}
.modal input,.modal textarea,.modal select{width:100%;padding:8px 12px;border-radius:6px;border:1px solid var(--bg3);background:var(--bg);color:var(--text);margin-bottom:12px}
.modal textarea{min-height:80px;resize:vertical}
.modal-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:8px}

@media(max-width:768px){
  .grid{grid-template-columns:1fr}
  .header{flex-direction:column;align-items:flex-start}
  .toolbar{flex-direction:column;align-items:stretch}
  .search-box{width:100%}
}
</style>
</head>
<body>

<header class="header" role="banner">
  <div class="header-left">
    <div class="logo">ProjectsHome <span>/hub</span></div>
    <div class="stats" id="stats" aria-live="polite">
      <span><b id="stat-total">0</b> projects</span>
      <span><b id="stat-active">0</b> active</span>
      <span><b id="stat-sessions">0</b> sessions</span>
      <span><b id="stat-messages">0</b> messages</span>
    </div>
  </div>
  <div class="header-right">
    <div class="bot-status" id="bot-status">
      <span class="bot-dot off" id="bot-dot"></span>
      <span id="bot-label">Bot: checking...</span>
    </div>
    <button class="btn btn-outline" onclick="doScan()" aria-label="Scan for projects">Scan</button>
    <button class="btn btn-primary" onclick="openAddModal()" aria-label="Add a new project">+ Add Project</button>
  </div>
</header>

<div class="tabs-bar" role="tablist">
  <button class="tab active" role="tab" aria-selected="true" id="tab-bot" onclick="switchTab('bot')">Local Bot</button>
  <button class="tab" role="tab" aria-selected="false" id="tab-claude" onclick="switchTab('claude')">Claude Code</button>
</div>

<div class="task-bar" id="task-bar">
  <span class="task-icon" aria-hidden="true">&#9889;</span>
  <input class="task-input" id="task-input" type="text"
    placeholder="Describe a task for the local bot... (e.g. create a hello world python script)"
    aria-label="Task input for local bot"
    onkeydown="if(event.key==='Enter')sendTask()">
  <span class="task-hint"><kbd>Enter</kbd> to send</span>
</div>

<div class="toolbar">
  <input class="search-box" id="search" type="search" placeholder="Search projects... (press /)"
    aria-label="Search projects" oninput="filterProjects()">
  <div style="display:flex;align-items:center;gap:12px">
    <div class="filters" role="group" aria-label="Filter projects">
      <button class="filter-btn active" data-filter="all" onclick="setFilter('all',this)">All</button>
      <button class="filter-btn" data-filter="active" onclick="setFilter('active',this)">Active</button>
      <button class="filter-btn" data-filter="pinned" onclick="setFilter('pinned',this)">Pinned</button>
      <button class="filter-btn" data-filter="PC" onclick="setFilter('PC',this)">&#128187; PC</button>
      <button class="filter-btn" data-filter="IOS" onclick="setFilter('IOS',this)">&#128241; IOS</button>
      <button class="filter-btn" data-filter="idea" onclick="setFilter('idea',this)">&#128161; Ideas</button>
    </div>
    <div class="view-toggle" role="group" aria-label="View mode">
      <button class="view-btn active" id="view-grid" onclick="setView('grid')" aria-label="Grid view">&#9638;</button>
      <button class="view-btn" id="view-list" onclick="setView('list')" aria-label="List view">&#9776;</button>
    </div>
  </div>
</div>

<main class="grid" id="project-grid" role="main" aria-label="Projects">
</main>

<!-- Add Project Modal -->
<div class="modal-overlay" id="modal-overlay" onclick="if(event.target===this)closeModal()">
  <div class="modal" role="dialog" aria-labelledby="modal-title">
    <h2 id="modal-title">Add Project</h2>
    <label for="m-name">Name</label>
    <input id="m-name" type="text" placeholder="Project name">
    <label for="m-desc">Description</label>
    <textarea id="m-desc" placeholder="Short description"></textarea>
    <label for="m-status">Status</label>
    <select id="m-status">
      <option value="active">Active</option>
      <option value="concept">Concept</option>
      <option value="in progress">In Progress</option>
      <option value="completed">Completed</option>
      <option value="idea">Idea</option>
    </select>
    <label for="m-platform">Platform</label>
    <select id="m-platform">
      <option value="PC">PC</option>
      <option value="IOS">iOS</option>
    </select>
    <label for="m-path">Path (optional)</label>
    <input id="m-path" type="text" placeholder="D:\ProjectsHome\my-project">
    <label for="m-repo">GitHub Repo (optional)</label>
    <input id="m-repo" type="text" placeholder="owner/repo">
    <div class="modal-actions">
      <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="addProject()">Add</button>
    </div>
  </div>
</div>

<script>
let projects=[], currentFilter='all', currentSearch='', currentView='grid';

async function fetchJSON(url,opts){
  const r=await fetch(url,{headers:{'Content-Type':'application/json'},...opts});
  return r.json();
}

async function loadProjects(){
  const data=await fetchJSON('/api/projects');
  projects=data.projects||[];
  renderProjects();
}

async function loadStats(){
  const s=await fetchJSON('/api/stats');
  document.getElementById('stat-total').textContent=s.total_projects||0;
  document.getElementById('stat-active').textContent=s.active||0;
  document.getElementById('stat-sessions').textContent=s.sessions||0;
  document.getElementById('stat-messages').textContent=s.messages||0;
}

async function checkBot(){
  try{
    const s=await fetchJSON('/api/bot/status');
    const dot=document.getElementById('bot-dot');
    const label=document.getElementById('bot-label');
    if(s.online){dot.className='bot-dot on';label.textContent='Bot: online ('+s.model+')';}
    else{dot.className='bot-dot off';label.textContent='Bot: offline';}
  }catch(e){
    document.getElementById('bot-dot').className='bot-dot off';
    document.getElementById('bot-label').textContent='Bot: offline';
  }
}

function timeAgo(dateStr){
  if(!dateStr)return'';
  const d=new Date(dateStr);
  const now=new Date();
  const diff=Math.floor((now-d)/(1000*60*60*24));
  if(diff===0)return'today';
  if(diff===1)return'1d ago';
  if(diff<30)return diff+'d ago';
  if(diff<365)return Math.floor(diff/30)+'mo ago';
  return Math.floor(diff/365)+'y ago';
}

function statusBadgeClass(status){
  if(!status)return'badge-active';
  const s=status.toLowerCase();
  if(s==='completed')return'badge-completed';
  if(s==='concept')return'badge-concept';
  if(s==='in progress')return'badge-progress';
  if(s==='idea')return'badge-idea';
  return'badge-active';
}

function platformIcon(p){
  if(p==='IOS')return'&#128241;';
  return'&#128187;';
}

function matchesFilter(proj){
  if(currentFilter==='all')return true;
  if(currentFilter==='active')return proj.status==='active'||proj.status==='in progress';
  if(currentFilter==='pinned')return proj.pinned;
  if(currentFilter==='PC'||currentFilter==='IOS')return proj.platform===currentFilter;
  if(currentFilter==='idea')return proj.status==='idea'||proj.status==='concept';
  return true;
}

function matchesSearch(proj){
  if(!currentSearch)return true;
  const q=currentSearch.toLowerCase();
  return(proj.name||'').toLowerCase().includes(q)||(proj.description||'').toLowerCase().includes(q)||(proj.tags||[]).some(t=>t.toLowerCase().includes(q));
}

function renderProjects(){
  const grid=document.getElementById('project-grid');
  const filtered=projects.filter(p=>matchesFilter(p)&&matchesSearch(p));
  if(filtered.length===0){
    grid.innerHTML='<div class="empty" style="grid-column:1/-1"><h3>No projects found</h3><p>Try a different filter or add a new project.</p></div>';
    return;
  }
  grid.innerHTML=filtered.map(p=>`
    <div class="card" tabindex="0" role="article" aria-label="${esc(p.name)}">
      <div class="card-title">${esc(p.name)}</div>
      <div class="card-desc">${esc(p.description||'')}</div>
      <div class="card-footer">
        <div class="card-meta">
          <span class="badge ${statusBadgeClass(p.status)}">${esc(p.status||'active')}</span>
          <span class="platform-tag">${platformIcon(p.platform)} ${esc(p.platform||'PC')}</span>
        </div>
        <span class="card-time">${timeAgo(p.updated)}</span>
      </div>
      ${p.path?`<div class="card-path"><span>${esc(p.path)}</span><button class="copy-btn" onclick="event.stopPropagation();copyPath('${esc(p.path)}')" aria-label="Copy path">&#128203;</button></div>`:''}
      ${p.path?`<div class="card-actions">
        <button class="action-btn" onclick="event.stopPropagation();openTerminal('${esc(p.path)}')"><span class="icon">&#9654;</span> Terminal</button>
        <button class="action-btn" onclick="event.stopPropagation();openExplorer('${esc(p.path)}')"><span class="icon">&#128193;</span> Explorer</button>
        <button class="action-btn" onclick="event.stopPropagation();openClaude('${esc(p.path)}')"><span class="icon">&#10026;</span> Claude</button>
        <button class="action-btn" onclick="event.stopPropagation();openBot('${esc(p.name)}')"><span class="icon">&#9678;</span> Bot</button>
      </div>`:''}
    </div>
  `).join('');
}

function esc(s){return(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}

function setFilter(f,el){
  currentFilter=f;
  document.querySelectorAll('.filter-btn').forEach(b=>b.classList.remove('active'));
  if(el)el.classList.add('active');
  renderProjects();
}

function filterProjects(){currentSearch=document.getElementById('search').value;renderProjects();}

function setView(v){
  currentView=v;
  document.getElementById('view-grid').classList.toggle('active',v==='grid');
  document.getElementById('view-list').classList.toggle('active',v==='list');
  const grid=document.getElementById('project-grid');
  grid.style.gridTemplateColumns=v==='list'?'1fr':'repeat(auto-fill,minmax(360px,1fr))';
}

async function doScan(){
  const r=await fetchJSON('/api/projects/scan',{method:'POST'});
  await loadProjects();
  await loadStats();
  alert(r.message||'Scan complete');
}

function openAddModal(){document.getElementById('modal-overlay').classList.add('open');}
function closeModal(){document.getElementById('modal-overlay').classList.remove('open');}

async function addProject(){
  const proj={
    name:document.getElementById('m-name').value,
    description:document.getElementById('m-desc').value,
    status:document.getElementById('m-status').value,
    platform:document.getElementById('m-platform').value,
    path:document.getElementById('m-path').value||undefined,
    repo:document.getElementById('m-repo').value||undefined,
  };
  if(!proj.name){alert('Name is required');return;}
  await fetchJSON('/api/projects',{method:'POST',body:JSON.stringify(proj)});
  closeModal();
  await loadProjects();
  await loadStats();
}

async function sendTask(){
  const input=document.getElementById('task-input');
  const prompt=input.value.trim();
  if(!prompt)return;
  input.value='';
  input.placeholder='Thinking...';
  try{
    const r=await fetchJSON('/api/bot/chat',{method:'POST',body:JSON.stringify({prompt})});
    input.placeholder=r.response?(r.response.substring(0,120)+'...'):'Done. Check messages.';
    setTimeout(()=>{input.placeholder='Describe a task for the local bot...';},8000);
    await loadStats();
  }catch(e){input.placeholder='Bot error. Is Ollama running?';setTimeout(()=>{input.placeholder='Describe a task for the local bot...';},5000);}
}

function copyPath(p){navigator.clipboard?.writeText(p);}
function openTerminal(p){fetchJSON('/api/messages',{method:'POST',body:JSON.stringify({role:'system',content:'Open terminal: '+p})});}
function openExplorer(p){fetchJSON('/api/messages',{method:'POST',body:JSON.stringify({role:'system',content:'Open explorer: '+p})});}
function openClaude(p){fetchJSON('/api/messages',{method:'POST',body:JSON.stringify({role:'system',content:'Open Claude Code: '+p})});}
function openBot(name){document.getElementById('task-input').value='Help me with the '+name+' project: ';document.getElementById('task-input').focus();}

function switchTab(tab){
  document.getElementById('tab-bot').classList.toggle('active',tab==='bot');
  document.getElementById('tab-claude').classList.toggle('active',tab==='claude');
  const bar=document.getElementById('task-bar');
  const input=document.getElementById('task-input');
  if(tab==='claude'){input.placeholder='Describe a task for Claude Code...';}
  else{input.placeholder='Describe a task for the local bot...';}
}

// Keyboard shortcut: / to focus search
document.addEventListener('keydown',e=>{
  if(e.key==='/'&&document.activeElement.tagName!=='INPUT'&&document.activeElement.tagName!=='TEXTAREA'){
    e.preventDefault();document.getElementById('search').focus();
  }
  if(e.key==='Escape'){closeModal();}
});

// Init
(async()=>{
  await loadProjects();
  await loadStats();
  await checkBot();
  setInterval(checkBot,30000);
  setInterval(loadStats,60000);
})();
</script>
</body>
</html>"""


# ─── Main ─────────────────────────────────────────────────────────────────────

class ThreadedServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    allow_reuse_address = True
    daemon_threads = True


def main():
    global PORT, PROJECTS_ROOT

    # Parse CLI args
    args = sys.argv[1:]
    i = 0
    while i < len(args):
        if args[i] == "--port" and i + 1 < len(args):
            PORT = int(args[i + 1])
            i += 2
        elif args[i] == "--root" and i + 1 < len(args):
            PROJECTS_ROOT = args[i + 1]
            i += 2
        else:
            i += 1

    # Auto-scan on startup
    print(f"[hub] Projects root: {PROJECTS_ROOT}")
    if Path(PROJECTS_ROOT).exists():
        scanned = scan_directory(PROJECTS_ROOT)
        store = load_projects()
        for proj in scanned:
            store.setdefault("projects", {})[proj["id"]] = proj
        save_projects(store)
        print(f"[hub] Scanned {len(scanned)} projects from {PROJECTS_ROOT}")
    else:
        print(f"[hub] Projects root not found: {PROJECTS_ROOT}")

    server = ThreadedServer(("0.0.0.0", PORT), HubHandler)
    print(f"[hub] ProjectsHome Hub running at http://localhost:{PORT}")
    print(f"[hub] Press Ctrl+C to stop")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[hub] Shutting down.")
        server.shutdown()


if __name__ == "__main__":
    main()
