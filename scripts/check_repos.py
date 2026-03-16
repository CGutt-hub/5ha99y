#!/usr/bin/env python3
"""
Lightweight check: compare pushed_at timestamps of all public repos
against a stored snapshot. Exits with output 'changed=true' if any
repo was created, deleted, or pushed to since last check.
Uses a single GitHub API call (list repos).
"""

import json
import os
import requests
import sys
from pathlib import Path

GITHUB_USERNAME = "CGutt-hub"
SNAPSHOT_FILE = Path(__file__).parent.parent / "data" / "repo_snapshots.json"

headers: dict[str, str] = {"User-Agent": "Mozilla/5.0"}
token = os.environ.get("GITHUB_TOKEN")
if token:
    headers["Authorization"] = f"token {token}"


def fetch_current_state() -> dict[str, str]:
    """Fetch pushed_at for all public repos (1 API call)."""
    url = f"https://api.github.com/users/{GITHUB_USERNAME}/repos"
    resp = requests.get(url, params={"per_page": 100, "sort": "pushed"}, headers=headers)
    resp.raise_for_status()
    return {r["name"]: r["pushed_at"] for r in resp.json() if not r["fork"]}


def load_snapshot() -> dict[str, str]:
    if SNAPSHOT_FILE.exists():
        with open(SNAPSHOT_FILE, "r") as f:
            return json.load(f)
    return {}


def save_snapshot(state: dict[str, str]) -> None:
    SNAPSHOT_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(SNAPSHOT_FILE, "w") as f:
        json.dump(state, f, indent=2)


def main() -> None:
    current = fetch_current_state()
    previous = load_snapshot()

    changed = current != previous

    if changed:
        # Identify what changed for logging
        new_repos = set(current) - set(previous)
        removed = set(previous) - set(current)
        updated = {k for k in current if k in previous and current[k] != previous[k]}
        if new_repos:
            print(f"[check] New repos: {', '.join(new_repos)}")
        if removed:
            print(f"[check] Removed repos: {', '.join(removed)}")
        if updated:
            print(f"[check] Updated repos: {', '.join(updated)}")
        save_snapshot(current)
    else:
        print("[check] No changes detected.")

    # Write output for GitHub Actions
    gh_output = os.environ.get("GITHUB_OUTPUT")
    if gh_output:
        with open(gh_output, "a") as f:
            f.write(f"changed={'true' if changed else 'false'}\n")

    sys.exit(0)


if __name__ == "__main__":
    main()
