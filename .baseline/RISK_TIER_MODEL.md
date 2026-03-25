# Risk Tier Model

## Overview

Every branch must be classified by its risk tier. This determines isolation requirements, governance expectations, and safeguards.

## Tier Definitions

### Tier 0: Documentation / Low Risk

- **Description:** Documentation-only changes, README updates, comment improvements
- **Permissions:** Read baseline, write docs only
- **Isolation:** Minimal - standard branch
- **Safeguards:** Standard PR review
- **Write Operations:** Documentation files only
- **External Integrations:** None
- **Branch Area:** Normal branches
- **Manifest Label:** `"risk_tier": 0`

### Tier 1: Standard Project Branch

- **Description:** Normal feature development, bug fixes, refactoring
- **Permissions:** Read/write source code within scope
- **Isolation:** Standard branch isolation
- **Safeguards:** PR review, CI checks
- **Write Operations:** Source code, tests, configuration
- **External Integrations:** None or standard (package registries)
- **Branch Area:** Normal branches
- **Manifest Label:** `"risk_tier": 1`

### Tier 2: Automation-Capable Branch

- **Description:** CI/CD changes, build automation, test automation, scheduled tasks
- **Permissions:** Read/write source + CI configuration
- **Isolation:** Standard branch with CI awareness
- **Safeguards:** PR review, CI checks, manual approval for deployment changes
- **Write Operations:** Source code, CI configs, scripts
- **External Integrations:** CI/CD systems, package registries
- **Branch Area:** Normal branches
- **Manifest Label:** `"risk_tier": 2`

### Tier 3: System-Integrated Agent / Bot Branch

- **Description:** Bots, agents, orchestrators that interact with external systems
- **Permissions:** Read/write source + external API access
- **Isolation:** Enhanced isolation recommended
- **Safeguards:** PR review, CI checks, security review for API integrations
- **Write Operations:** Source code, API configurations, agent logic
- **External Integrations:** External APIs, messaging systems, monitoring
- **Additional Review:** Required before merge
- **Sensitive File Duplication:** Prohibited without explicit approval
- **Branch Area:** Normal branches or elevated zone depending on scope
- **Manifest Label:** `"risk_tier": 3`

### Tier 4: High-Authority / Invasive Branch

- **Description:** Deeply integrated systems, commanding orchestrators, system-level automation, tools with broad write access
- **Permissions:** Broad system access, elevated authority
- **Isolation:** **Mandatory dedicated isolation in `.baseline/elevated/`**
- **Safeguards:** Security review, explicit authorization, enhanced monitoring
- **Write Operations:** Constrained to branch scope; system-wide writes require approval
- **External Integrations:** Multiple external systems, potentially privileged access
- **Additional Review:** Mandatory before any integration
- **Sensitive File Duplication:** Prohibited
- **Branch Area:** **Elevated-risk zone only**
- **Manifest Label:** `"risk_tier": 4`
- **Warning:** Must be clearly marked in branch manifest and identity files

## Risk Assessment Checklist

When determining risk tier, consider:

1. Does the branch modify CI/CD pipelines? (Tier 2+)
2. Does the branch interact with external APIs? (Tier 3+)
3. Does the branch have autonomous decision-making capability? (Tier 3+)
4. Does the branch have system-level write access? (Tier 4)
5. Does the branch control other processes or services? (Tier 4)
6. Does the branch handle credentials or secrets? (Tier 3+)
7. Could the branch cause damage if it malfunctions? (Tier 3+)
8. Is the branch experimental with unknown risk profile? (Tier 2+ minimum)

## Escalation

If a branch's risk profile changes during development (e.g., a Tier 1 feature grows to include automation), the branch manifest must be updated and the branch may need to be relocated to the elevated zone.
