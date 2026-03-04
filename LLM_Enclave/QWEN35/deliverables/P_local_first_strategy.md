# DELIVERABLE P: Local-First Model Strategy and Escalation Protocol

## P1. Qwen Local Is Default for All Tasks

**Rule:** Every task starts with Qwen local via Ollama. No exceptions.

The default workflow is:
1. User presents a task (coding, refactoring, docs, patch generation, review, analysis).
2. The task is routed to Qwen local via OpenClaw and the Workspace Bridge.
3. The model processes the task entirely offline.
4. Output is reviewed and applied via the bridge workflow.

There is NO automatic fallback to any cloud model. The system does not silently escalate.

## P2. Claude Code Used Only After Structured Attempt Process

Before escalating to Claude Code (paid API), the user must complete the following structured attempt process:

### Structured Attempt Process

```
STEP 1: Attempt with Qwen local (default model/quantization)
        - Run the task through Qwen via OpenClaw
        - If output is satisfactory: DONE (no escalation needed)
        - If output is unsatisfactory: proceed to Step 2

STEP 2: Retry with adjusted prompt
        - Rephrase the prompt with more context, examples, or constraints
        - Break complex tasks into smaller sub-tasks
        - If output is satisfactory: DONE
        - If still unsatisfactory: proceed to Step 3

STEP 3: Retry with different model parameters
        - Adjust temperature, top_p, max_tokens
        - Try a different quantization level if available
        - If output is satisfactory: DONE
        - If still unsatisfactory: proceed to Step 4

STEP 4: Document the failure and escalate
        - Record what was attempted and why it failed
        - Fill out the escalation checklist (P4)
        - Manually approve cloud usage
        - Use Claude Code for this specific task
        - Record the escalation in the audit log
```

## P3. No Silent Cloud Fallback

**Hard Rule:** The system must NEVER silently call a cloud API.

Enforcement mechanisms:
1. **Firewall rules**: All enclave processes are blocked from outbound. Cloud APIs cannot be reached.
2. **No API keys in enclave**: No Claude API key, no OpenAI API key, no Anthropic API key is stored in the enclave. These keys live outside the enclave, in your normal development environment.
3. **Separate execution contexts**: Qwen runs in the enclave. Claude Code runs in your normal terminal. They are separate processes with separate network permissions.
4. **Audit log**: Every cloud usage is manually recorded (see P6, P7).

## P4. Escalation Checklist (Manual Approval Required)

Before using Claude Code (paid API), complete this checklist:

```
CLOUD ESCALATION CHECKLIST
===========================
Date: _______________
Task description (no source code): ________________________________
________________________________________________________

[  ] Step 1 completed: Attempted with Qwen local
[  ] Step 2 completed: Retried with adjusted prompt
[  ] Step 3 completed: Retried with different parameters
[  ] Qwen output was genuinely insufficient (not just "different")

Reason category (check one):
[  ] Large cross-repo reasoning (multiple repos, complex dependencies)
[  ] Complex multi-step refactor with high correctness requirement
[  ] Ambiguous bug root cause requiring deep analysis
[  ] Task requiring very high correctness under time pressure
[  ] Security-sensitive code requiring frontier-level review
[  ] Other: ________________________________

Estimated API cost concern level: [  ] Low  [  ] Medium  [  ] High

Files involved (count only, no filenames in this checklist): ___

APPROVAL:
I confirm that local inference was genuinely insufficient for this task
and I authorize the use of paid API credits for this specific task.

Signed: ________________________  Date: _______________
```

## P5. Rules for What Qualifies as "Requires Claude"

| Category | Description | Example |
|----------|-------------|---------|
| Large cross-repo reasoning | Task spans 3+ repositories and requires understanding their interactions | Coordinating API changes across frontend, backend, and shared library repos |
| Complex multi-step refactors | Refactoring that touches 10+ files with interdependencies and high risk of regression | Migrating a codebase from one framework to another |
| Ambiguous bug root causes | Bug that defies straightforward analysis and requires deep reasoning about edge cases | Race condition that only manifests under specific timing and load patterns |
| High correctness + time pressure | Task where getting it wrong has significant consequences and speed matters | Fixing a production security vulnerability during an incident |
| Security-sensitive review | Code that handles authentication, authorization, cryptography, or sensitive data | Reviewing a custom authentication flow for vulnerabilities |
| Frontier-level code generation | Task requiring state-of-the-art code quality that local models consistently fail at | Implementing a complex algorithm with subtle correctness requirements |

**What does NOT qualify:**
- Routine code completion (Qwen handles this)
- Documentation writing (Qwen handles this)
- Simple refactors (rename, extract function, move file)
- Code formatting or linting
- Generating test cases for well-defined functions
- Explaining code
- Generating boilerplate
- Simple bug fixes with clear root causes

## P6. Cost-Control Guardrail

### Local Cost Tracking

Every time Claude Code is used for a task related to this ecosystem, record it:

```powershell
# After completing a Claude Code task, record the usage
$logPath = "D:\ProjectsHome\LLM_Enclave\QWEN35\logs\cloud_escalation_audit.log"

$entry = @{
    timestamp         = (Get-Date -Format "yyyy-MM-dd HH:mm:ss")
    reason_category   = "complex_refactor"  # Use categories from P5
    files_touched     = 12                  # Count only
    confirmation      = "Lance confirmed escalation"
    task_summary      = "Multi-repo API migration"  # Brief, no source code
    estimated_tokens  = 50000               # Rough estimate if known
    model_used        = "claude-opus-4-6"  # Which Claude model
}

$logLine = "$($entry.timestamp) | CATEGORY=$($entry.reason_category) | FILES=$($entry.files_touched) | MODEL=$($entry.model_used) | SUMMARY=$($entry.task_summary) | CONFIRMED=$($entry.confirmation)"
Add-Content -Path $logPath -Value $logLine
```

### Monthly Summary

```powershell
# Generate a summary of cloud usage for the current month
$logPath = "D:\ProjectsHome\LLM_Enclave\QWEN35\logs\cloud_escalation_audit.log"
$currentMonth = Get-Date -Format "yyyy-MM"

$entries = Get-Content $logPath | Where-Object { $_ -match "^$currentMonth" }

Write-Host "=== Cloud Usage Summary for $currentMonth ===" -ForegroundColor Cyan
Write-Host "Total escalations: $($entries.Count)"

# Group by category
$entries | ForEach-Object {
    if ($_ -match "CATEGORY=(\w+)") { $matches[1] }
} | Group-Object | ForEach-Object {
    Write-Host "  $($_.Name): $($_.Count)"
}
```

## P7. Cloud Escalation Audit Log Format

Location: `D:\ProjectsHome\LLM_Enclave\QWEN35\logs\cloud_escalation_audit.log`

### Format

```
TIMESTAMP | CATEGORY=reason_category | FILES=count | MODEL=model_id | SUMMARY=brief_text | CONFIRMED=confirmation_note
```

### Rules

1. This log NEVER contains proprietary source code.
2. This log NEVER contains file paths or filenames (only counts).
3. This log NEVER contains prompt text or model responses.
4. This log contains ONLY metadata: timestamp, reason category, files touched count, model used, brief summary, and confirmation note.
5. This log is stored locally only. It is never synced, uploaded, or shared.
6. The summary field must be a brief, high-level description (5-10 words max) that does not reveal proprietary details.

### Example Entries

```
2025-01-15 10:30:00 | CATEGORY=cross_repo_reasoning | FILES=8 | MODEL=claude-opus-4-6 | SUMMARY=API migration coordination | CONFIRMED=Lance confirmed escalation
2025-01-18 14:22:00 | CATEGORY=security_review | FILES=3 | MODEL=claude-sonnet-4-6 | SUMMARY=Auth flow review | CONFIRMED=Lance confirmed escalation
2025-01-25 09:10:00 | CATEGORY=ambiguous_bug | FILES=5 | MODEL=claude-opus-4-6 | SUMMARY=Race condition diagnosis | CONFIRMED=Lance confirmed escalation
```
