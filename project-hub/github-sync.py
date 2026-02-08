#!/usr/bin/env python3
"""
GitHub Sync for ProjectHub

Syncs projects between GitHub repos (iPhone Claude sessions) and the local
ProjectHub dashboard (Windows Claude Code sessions).

This runs as a background task or on-demand to:
1. Scan GitHub repos for project-hub.json files
2. Register discovered projects with the local Hub
3. Push local project configs to GitHub repos (bidirectional)

Usage:
    python github-sync.py                  # Sync all repos
    python github-sync.py --watch          # Continuous sync every 30 min
    python github-sync.py --repo owner/name  # Sync one repo
"""

import json
import os
import sys
import time
import urllib.request
import urllib.error
from pathlib import Path
from datetime import datetime

GITHUB_API = "https://api.github.com"
HUB_URL = os.environ.get("PROJECT_HUB_URL", "http://localhost:8090")
GITHUB_USER = os.environ.get("GITHUB_USER", "lance-fisher")
GITHUB_TOKEN = os.environ.get("GITHUB_TOKEN", "")


def github_request(path: str, method: str = "GET", data: dict = None) -> dict:
    """Make an authenticated GitHub API request."""
    url = f"{GITHUB_API}{path}"
    body = json.dumps(data).encode("utf-8") if data else None
    req = urllib.request.Request(url, data=body, method=method)
    req.add_header("Accept", "application/vnd.github.v3+json")
    req.add_header("User-Agent", "ProjectHub-Sync/1.0")
    if GITHUB_TOKEN:
        req.add_header("Authorization", f"token {GITHUB_TOKEN}")
    if data:
        req.add_header("Content-Type", "application/json")

    try:
        resp = urllib.request.urlopen(req, timeout=15)
        return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        print(f"  GitHub API error ({e.code}): {path}")
        return {}
    except Exception as e:
        print(f"  GitHub API error: {e}")
        return {}


def list_user_repos() -> list:
    """List all repos for the configured GitHub user."""
    repos = []
    page = 1
    while True:
        result = github_request(f"/users/{GITHUB_USER}/repos?per_page=100&page={page}&sort=updated")
        if not result or not isinstance(result, list) or len(result) == 0:
            break
        repos.extend(result)
        if len(result) < 100:
            break
        page += 1
    return repos


def check_repo_for_project_config(owner: str, repo: str) -> dict:
    """Check if a GitHub repo has a project-hub.json file."""
    for filename in ["project-hub.json", ".project.json"]:
        result = github_request(f"/repos/{owner}/{repo}/contents/{filename}")
        if result and result.get("content"):
            import base64
            content = base64.b64decode(result["content"]).decode("utf-8")
            try:
                return json.loads(content)
            except json.JSONDecodeError:
                pass
    return {}


def check_repo_branches_for_claude(owner: str, repo: str) -> list:
    """Find branches created by Claude (iPhone or desktop sessions)."""
    branches = github_request(f"/repos/{owner}/{repo}/branches?per_page=100")
    if not isinstance(branches, list):
        return []
    return [b for b in branches if b.get("name", "").startswith("claude/")]


def register_with_hub(meta: dict):
    """Register a project with the local ProjectHub server."""
    try:
        data = json.dumps(meta).encode("utf-8")
        req = urllib.request.Request(
            f"{HUB_URL}/api/projects",
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        resp = urllib.request.urlopen(req, timeout=5)
        return json.loads(resp.read())
    except Exception:
        return None


def sync_repo(owner: str, repo_name: str, repo_data: dict = None):
    """Sync a single GitHub repo with ProjectHub."""
    print(f"  Syncing {owner}/{repo_name}...")

    # Get repo metadata
    if not repo_data:
        repo_data = github_request(f"/repos/{owner}/{repo_name}")
    if not repo_data:
        return

    # Check for project config in repo
    config = check_repo_for_project_config(owner, repo_name)

    # Check for Claude branches
    claude_branches = check_repo_branches_for_claude(owner, repo_name)

    # Build project metadata
    meta = {
        "name": config.get("name", repo_data.get("name", repo_name).replace("-", " ").replace("_", " ").title()),
        "description": config.get("description", repo_data.get("description", "")),
        "status": config.get("status", "active"),
        "platform": config.get("platform", "PC"),
        "tags": config.get("tags", repo_data.get("topics", [])),
        "repo": repo_data.get("html_url", f"https://github.com/{owner}/{repo_name}"),
        "github_repo": f"{owner}/{repo_name}",
        "source": "github",
        "updated": repo_data.get("updated_at", datetime.now().isoformat())[:10],
        "claude_branches": [b["name"] for b in claude_branches],
    }

    if config:
        meta.update(config)

    # Register with local Hub
    result = register_with_hub(meta)
    if result:
        print(f"    Registered: {meta['name']}")
    else:
        print(f"    Hub not reachable, skipping registration")


def sync_all():
    """Sync all GitHub repos."""
    print(f"Syncing repos for {GITHUB_USER}...")
    repos = list_user_repos()
    print(f"Found {len(repos)} repos")

    for repo in repos:
        # Only sync repos that were updated recently or have Claude branches
        sync_repo(GITHUB_USER, repo["name"], repo)

    print("Sync complete.")


def watch_mode(interval_minutes: int = 30):
    """Continuously sync on an interval."""
    print(f"Watch mode: syncing every {interval_minutes} minutes")
    while True:
        sync_all()
        print(f"Next sync in {interval_minutes} minutes...")
        time.sleep(interval_minutes * 60)


def main():
    if not GITHUB_TOKEN:
        print("Warning: GITHUB_TOKEN not set. API rate limits will be restrictive.")
        print("Set it with: export GITHUB_TOKEN=your_token")
        print()

    if "--watch" in sys.argv:
        watch_mode()
    elif "--repo" in sys.argv:
        idx = sys.argv.index("--repo")
        if idx + 1 < len(sys.argv):
            slug = sys.argv[idx + 1]
            owner, repo = slug.split("/", 1) if "/" in slug else (GITHUB_USER, slug)
            sync_repo(owner, repo)
        else:
            print("Usage: python github-sync.py --repo owner/repo")
    else:
        sync_all()


if __name__ == "__main__":
    main()
