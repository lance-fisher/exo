# Branch Rules

## Branch: {{BRANCH_NAME}}

These rules apply specifically to this branch and supplement (or override) the baseline governance.

## Inherited Rules

This branch inherits all rules from the baseline unless explicitly overridden below:
- Coding standards (2-space indent, 200 max line length, black/ruff/pylint)
- Git conventions (no direct push to main, no force push)
- Non-destructive default behavior

## Local Overrides

{{LOCAL_OVERRIDES_OR_NONE}}

## Branch-Specific Rules

{{BRANCH_SPECIFIC_RULES_OR_NONE}}

## Prohibited Actions

- Modifying baseline governance files (`.baseline/`)
- Committing secrets or credentials
- Force pushing to `main`
- Deleting baseline files
