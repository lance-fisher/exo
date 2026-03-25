# Elevated-Risk Systems Zone

## Purpose

This directory is the designated isolation area for high-authority, invasive, commanding, deeply integrated, or automation-heavy systems. Any system classified as **Risk Tier 3-4** should be developed with awareness of this zone's governance.

## Why This Exists

Some future work may require:
- Broad system access
- Autonomous decision-making
- External API integrations with privileged access
- Process control or orchestration
- System-level write operations

Such systems must never be embedded directly into the master baseline. They must be clearly identified, governed, and isolated.

## Rules for Elevated Branches

1. **Must be clearly labeled** - Risk tier must be documented in branch manifest
2. **Must use elevated templates** - Use `elevated_branch_manifest_template.json`
3. **Must document authority** - What permissions does this system need?
4. **Must document impact** - What could go wrong?
5. **Must document integrations** - What external systems does it touch?
6. **Must be reviewed** - Tier 4 branches require explicit approval before merge
7. **Must not contaminate baseline** - Elevated code stays in its branch until reviewed
8. **Must not duplicate sensitive files** - No copying of credentials or secrets from baseline

## Elevated Branch Template

Use the template at `.baseline/elevated/elevated_branch_manifest_template.json` when creating elevated-risk branches.

## Directory Structure for Elevated Branches

Elevated branches may contain additional governance files:

```
branch_root/
  BRANCH_IDENTITY.md        # Standard identity (with elevated fields)
  branch_manifest.json       # Elevated manifest (with authority fields)
  AUTHORITY_TIER.md          # Explicit authority documentation
  OPERATING_SCOPE.md         # What this system is allowed to do
  IMPACT_ASSESSMENT.md       # What could go wrong
  ...
```

## Warning

Systems in this zone are expected to be powerful. Extra caution is required during development, review, and integration. When in doubt, keep the system isolated in its branch.
