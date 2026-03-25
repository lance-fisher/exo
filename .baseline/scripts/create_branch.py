#!/usr/bin/env python3
"""
Branch Creation Script for the exo Baseline Branch Architecture.

Creates a new derivative branch from the master baseline with proper
identity files, manifest, and governance structure.

Usage:
  python .baseline/scripts/create_branch.py --name my-feature --type feature --purpose "Add new model support" --risk-tier 1
  python .baseline/scripts/create_branch.py --name system-bot --type bot --purpose "Automated benchmarking" --risk-tier 3
  python .baseline/scripts/create_branch.py --name orchestrator --type elevated --purpose "System orchestration" --risk-tier 4
"""

import argparse
import json
import os
import subprocess
import sys
from datetime import datetime

BRANCH_TYPES = {
  "feature": {"prefix": "feature/", "default_tier": 1},
  "fix": {"prefix": "fix/", "default_tier": 1},
  "docs": {"prefix": "docs/", "default_tier": 0},
  "experiment": {"prefix": "experiment/", "default_tier": 1},
  "bot": {"prefix": "bot/", "default_tier": 3},
  "auto": {"prefix": "auto/", "default_tier": 2},
  "elevated": {"prefix": "elevated/", "default_tier": 4},
  "claude": {"prefix": "claude/", "default_tier": 1},
}

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BASELINE_DIR = os.path.dirname(SCRIPT_DIR)
REPO_ROOT = os.path.dirname(BASELINE_DIR)


def get_current_commit():
  try:
    result = subprocess.run(
      ["git", "rev-parse", "HEAD"],
      capture_output=True, text=True, check=True, cwd=REPO_ROOT
    )
    return result.stdout.strip()
  except subprocess.CalledProcessError:
    return "unknown"


def create_branch_identity(branch_name, branch_type, purpose, risk_tier, created_date):
  template_path = os.path.join(BASELINE_DIR, "templates", "BRANCH_IDENTITY_TEMPLATE.md")
  with open(template_path, "r") as f:
    content = f.read()

  replacements = {
    "{{BRANCH_NAME}}": branch_name,
    "{{BRANCH_TYPE}}": branch_type,
    "{{CREATED_DATE}}": created_date,
    "{{PURPOSE}}": purpose,
    "{{RISK_TIER}}": str(risk_tier),
    "{{SCOPE_DESCRIPTION}}": purpose,
    "{{HAS_LOCAL_OVERRIDES}}": "No",
    "{{EXTERNAL_INTEGRATIONS}}": "None" if risk_tier < 3 else "To be documented",
    "{{ACCESS_LEVEL}}": "Standard" if risk_tier < 3 else "Elevated - requires documentation",
    "{{AUTONOMOUS_BEHAVIOR}}": "No" if risk_tier < 3 else "To be documented",
    "{{ADDITIONAL_CONSTRAINTS}}": "None",
    "{{STANDALONE_REPO}}": "No",
    "{{LIFECYCLE}}": "active",
  }

  for key, value in replacements.items():
    content = content.replace(key, value)

  return content


def create_branch_manifest(branch_name, branch_type, purpose, risk_tier, created_date):
  if risk_tier >= 4:
    template_path = os.path.join(BASELINE_DIR, "elevated", "elevated_branch_manifest_template.json")
  else:
    template_path = os.path.join(BASELINE_DIR, "templates", "branch_manifest_template.json")

  with open(template_path, "r") as f:
    content = f.read()

  parent_commit = get_current_commit()

  replacements = {
    "{{BRANCH_NAME}}": branch_name,
    "{{BRANCH_TYPE}}": branch_type,
    "{{CREATED_DATE}}": created_date,
    "{{PURPOSE}}": purpose,
    "{{PARENT_COMMIT}}": parent_commit,
    "{{SYSTEM_ACCESS_DESCRIPTION}}": "To be documented",
    "{{IMPACT_SCOPE}}": "To be documented",
    "{{ROLLBACK_PLAN}}": "Delete branch and recreate from baseline",
  }

  for key, value in replacements.items():
    content = content.replace(key, value)

  # Parse and re-serialize to fix the risk_tier (which is a number in JSON)
  manifest = json.loads(content)
  manifest["risk_tier"] = risk_tier

  return json.dumps(manifest, indent=2)


def main():
  parser = argparse.ArgumentParser(description="Create a new derivative branch from the exo baseline")
  parser.add_argument("--name", required=True, help="Branch name (without prefix)")
  parser.add_argument("--type", required=True, choices=BRANCH_TYPES.keys(), help="Branch type")
  parser.add_argument("--purpose", required=True, help="One-sentence description of the branch purpose")
  parser.add_argument("--risk-tier", type=int, default=None, help="Risk tier (0-4). Defaults based on branch type.")
  parser.add_argument("--no-checkout", action="store_true", help="Create files but don't checkout the branch")
  parser.add_argument("--dry-run", action="store_true", help="Show what would be created without doing it")

  args = parser.parse_args()

  branch_type_info = BRANCH_TYPES[args.type]
  branch_full_name = f"{branch_type_info['prefix']}{args.name}"
  risk_tier = args.risk_tier if args.risk_tier is not None else branch_type_info["default_tier"]
  created_date = datetime.now().strftime("%Y-%m-%d")

  if risk_tier < 0 or risk_tier > 4:
    print("Error: Risk tier must be between 0 and 4")
    sys.exit(1)

  print(f"Branch Creation Plan:")
  print(f"  Name:      {branch_full_name}")
  print(f"  Type:      {args.type}")
  print(f"  Purpose:   {args.purpose}")
  print(f"  Risk Tier: {risk_tier}")
  print(f"  Date:      {created_date}")
  print()

  if risk_tier >= 3:
    print(f"  WARNING: This is a Tier {risk_tier} (elevated-risk) branch.")
    print(f"  Additional governance and review requirements apply.")
    print()

  if args.dry_run:
    print("Dry run - no changes made.")
    print("Files that would be created:")
    print(f"  BRANCH_IDENTITY.md")
    print(f"  branch_manifest.json")
    return

  # Create git branch
  if not args.no_checkout:
    try:
      subprocess.run(["git", "checkout", "-b", branch_full_name], check=True, cwd=REPO_ROOT)
      print(f"Created and checked out branch: {branch_full_name}")
    except subprocess.CalledProcessError as e:
      print(f"Error creating git branch: {e}")
      print("You may need to create the branch manually.")

  # Generate identity file
  identity_content = create_branch_identity(
    branch_full_name, args.type, args.purpose, risk_tier, created_date
  )
  identity_path = os.path.join(REPO_ROOT, "BRANCH_IDENTITY.md")
  with open(identity_path, "w") as f:
    f.write(identity_content)
  print(f"Created: BRANCH_IDENTITY.md")

  # Generate manifest
  manifest_content = create_branch_manifest(
    branch_full_name, args.type, args.purpose, risk_tier, created_date
  )
  manifest_path = os.path.join(REPO_ROOT, "branch_manifest.json")
  with open(manifest_path, "w") as f:
    f.write(manifest_content)
  print(f"Created: branch_manifest.json")

  print()
  print(f"Branch '{branch_full_name}' initialized successfully.")
  print(f"Next steps:")
  print(f"  1. Review BRANCH_IDENTITY.md and branch_manifest.json")
  print(f"  2. Commit the identity files")
  print(f"  3. Begin development")
  if risk_tier >= 3:
    print(f"  4. Document authority requirements before integration")


if __name__ == "__main__":
  main()
