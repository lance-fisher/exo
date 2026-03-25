# Branch Identity

## Metadata

- **Branch Name:** {{BRANCH_NAME}}
- **Branch Type:** {{BRANCH_TYPE}}
- **Created:** {{CREATED_DATE}}
- **Purpose:** {{PURPOSE}}
- **Risk Tier:** {{RISK_TIER}}
- **Parent Baseline:** exo (main)

## Scope

{{SCOPE_DESCRIPTION}}

## Inheritance

- **Baseline governance:** Referenced (not copied)
- **Source code:** Inherited via git branch
- **Configuration:** Inherited via git branch
- **Local overrides:** {{HAS_LOCAL_OVERRIDES}}

## Authority

- **External integrations:** {{EXTERNAL_INTEGRATIONS}}
- **System access level:** {{ACCESS_LEVEL}}
- **Autonomous behavior:** {{AUTONOMOUS_BEHAVIOR}}

## Constraints

- This branch must not modify `.baseline/` governance files without authorization
- This branch must not push directly to `main`
- This branch must not commit secrets or credentials
- {{ADDITIONAL_CONSTRAINTS}}

## Git Intent

- **Will this become a standalone repo?** {{STANDALONE_REPO}}
- **Target merge branch:** main
- **Expected lifecycle:** {{LIFECYCLE}}
