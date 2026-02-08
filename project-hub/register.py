#!/usr/bin/env python3
"""
Project Hub Auto-Registration Script

Call this from any project directory to register it with the ProjectHub dashboard.
Works from both Windows Claude Code sessions and iPhone Claude (via GitHub Actions).

Usage:
    python register.py                          # Register current directory
    python register.py /path/to/project         # Register specific path
    python register.py --github lance-fisher/repo  # Register a GitHub repo

The script:
1. Reads project metadata (project-hub.json, package.json, README, .git)
2. Writes/updates the project-hub.json config
3. Pings the running Hub server to refresh (if reachable)
"""

import json
import os
import sys
import re
import urllib.request
import urllib.error
from pathlib import Path
from datetime import datetime

HUB_URL = os.environ.get("PROJECT_HUB_URL", "http://localhost:8090")

def detect_metadata(project_dir: str) -> dict:
    """Auto-detect project metadata from directory contents."""
    p = Path(project_dir).resolve()
    meta = {
        "name": p.name.replace("-", " ").replace("_", " ").title(),
        "description": "",
        "status": "active",
        "platform": "PC",
        "tags": [],
        "path": str(p),
        "created": datetime.now().strftime("%Y-%m-%d"),
        "updated": datetime.now().strftime("%Y-%m-%d"),
    }

    # Check for existing project-hub.json
    for cfg_name in ["project-hub.json", ".project.json"]:
        cfg_path = p / cfg_name
        if cfg_path.exists():
            try:
                with open(cfg_path, "r", encoding="utf-8") as f:
                    existing = json.load(f)
                meta.update(existing)
                meta["updated"] = datetime.now().strftime("%Y-%m-%d")
                return meta
            except (json.JSONDecodeError, IOError):
                pass

    # Read package.json
    pkg_path = p / "package.json"
    if pkg_path.exists():
        try:
            with open(pkg_path, "r", encoding="utf-8") as f:
                pkg = json.load(f)
            if pkg.get("name"):
                meta["name"] = pkg["name"].replace("@", "").replace("/", " - ").title()
            if pkg.get("description"):
                meta["description"] = pkg["description"]
            meta["tags"].append("node")
        except (json.JSONDecodeError, IOError):
            pass

    # Read README
    for readme_name in ["README.md", "readme.md", "README.txt", "README"]:
        readme_path = p / readme_name
        if readme_path.exists():
            try:
                with open(readme_path, "r", encoding="utf-8") as f:
                    content = f.read(2000)
                # Extract first heading
                heading = re.search(r"^#\s+(.+)", content, re.MULTILINE)
                if heading and not meta.get("description"):
                    meta["name"] = heading.group(1).strip()
                # Extract first paragraph after heading
                paragraphs = re.findall(r"\n\n(.+?)(?:\n\n|\Z)", content, re.DOTALL)
                if paragraphs and not meta.get("description"):
                    meta["description"] = paragraphs[0].strip()[:300]
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
                url = url_match.group(1).strip()
                meta["repo"] = url
                # Extract repo name for GitHub links
                gh_match = re.search(r"github\.com[/:](.+?)(?:\.git)?$", url)
                if gh_match:
                    meta["github_repo"] = gh_match.group(1)
        except IOError:
            pass

    # Detect language/platform
    if (p / "Podfile").exists() or (p / "*.xcodeproj").exists():
        meta["platform"] = "IOS"
        meta["tags"].append("ios")
    if (p / "requirements.txt").exists() or (p / "setup.py").exists():
        meta["tags"].append("python")
    if (p / "Cargo.toml").exists():
        meta["tags"].append("rust")
    if (p / "docker-compose.yml").exists() or (p / "docker-compose.yaml").exists():
        meta["tags"].append("docker")
    if (p / "Makefile").exists():
        meta["tags"].append("make")

    return meta


def write_config(project_dir: str, meta: dict):
    """Write project-hub.json into the project directory."""
    cfg_path = Path(project_dir) / "project-hub.json"
    with open(cfg_path, "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2)
    print(f"Wrote {cfg_path}")


def ping_hub(meta: dict):
    """Notify running Hub server about the project."""
    try:
        data = json.dumps(meta).encode("utf-8")
        req = urllib.request.Request(
            f"{HUB_URL}/api/projects",
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        resp = urllib.request.urlopen(req, timeout=5)
        result = json.loads(resp.read())
        print(f"Hub notified: {result.get('message', 'OK')}")
    except urllib.error.URLError:
        print("Hub not reachable (not running?). Project config saved locally.")
    except Exception as e:
        print(f"Hub notification failed: {e}. Project config saved locally.")


def register_github_repo(repo_slug: str):
    """Register a GitHub repo by slug (owner/repo)."""
    meta = {
        "name": repo_slug.split("/")[-1].replace("-", " ").replace("_", " ").title(),
        "description": "",
        "status": "active",
        "platform": "PC",
        "tags": ["github"],
        "repo": f"https://github.com/{repo_slug}",
        "github_repo": repo_slug,
        "source": "github",
        "created": datetime.now().strftime("%Y-%m-%d"),
        "updated": datetime.now().strftime("%Y-%m-%d"),
    }

    # Try to get repo info from GitHub API
    try:
        req = urllib.request.Request(f"https://api.github.com/repos/{repo_slug}")
        token = os.environ.get("GITHUB_TOKEN")
        if token:
            req.add_header("Authorization", f"token {token}")
        resp = urllib.request.urlopen(req, timeout=10)
        repo_data = json.loads(resp.read())
        meta["name"] = repo_data.get("name", meta["name"]).replace("-", " ").replace("_", " ").title()
        meta["description"] = repo_data.get("description", "")
        meta["tags"].extend(repo_data.get("topics", []))
    except Exception:
        pass

    ping_hub(meta)
    return meta


def main():
    if len(sys.argv) > 1 and sys.argv[1] == "--github":
        if len(sys.argv) < 3:
            print("Usage: python register.py --github owner/repo")
            sys.exit(1)
        meta = register_github_repo(sys.argv[2])
        print(f"Registered GitHub repo: {meta['name']}")
        return

    project_dir = sys.argv[1] if len(sys.argv) > 1 else os.getcwd()

    if not os.path.isdir(project_dir):
        print(f"Error: {project_dir} is not a directory")
        sys.exit(1)

    meta = detect_metadata(project_dir)
    write_config(project_dir, meta)
    ping_hub(meta)
    print(f"Registered: {meta['name']} ({meta['status']})")


if __name__ == "__main__":
    main()
