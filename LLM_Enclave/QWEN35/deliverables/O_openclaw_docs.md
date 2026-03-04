# DELIVERABLE O: OpenClaw Documentation Bundle

## Files Generated

### 1. openclaw_install_record.md

Location: `D:\ProjectsHome\LLM_Enclave\QWEN35\docs\openclaw_install_record.md`
Content: See file H10

This file records:
- Installed version and commit hash
- Release tag and source URL
- List of installed components
- Dependency versions (pinned)
- Install date and machine context
- Integrity verification instructions
- Safe update procedure
- Complete removal instructions

### 2. README.md Updates

The main README at `D:\ProjectsHome\LLM_Enclave\QWEN35\docs\README.md` (file H7) includes an OpenClaw section covering:

#### OpenClaw Operation
- How to start OpenClaw
- How OpenClaw connects to Ollama
- How OpenClaw uses the Workspace Bridge
- How to configure OpenClaw's workspace scope

#### OpenClaw Security Model
- Why OpenClaw is treated as untrusted
- How containment is enforced (NTFS ACLs, firewall rules, bridge-only access)
- How plugins are handled (deny by default)
- How updates are handled

#### OpenClaw Update Instructions
1. Check for new releases on the official repository
2. Download to staging with hash verification
3. Back up current installation
4. Install new version
5. Verify firewall rules still apply
6. Update openclaw_install_record.md
7. Record change in changelog.md

#### OpenClaw Removal Instructions
1. Stop all OpenClaw processes
2. Remove the `openclaw\` directory
3. Remove OpenClaw firewall rules
4. Remove Docker container/image (if used)
5. Record removal in changelog

## Security Notes for README

The following warnings are included in the README:

```
SECURITY WARNINGS FOR OPENCLAW:

1. OpenClaw and its dependencies are treated as untrusted supply chain inputs.
   Verify every download before use.

2. OpenClaw plugins, extensions, and MCP servers are BLOCKED by default.
   Do not enable any plugin without:
   a. Reviewing its source code
   b. Computing and recording its hash
   c. Verifying it does not require network access
   d. Adding it to the verified plugin allowlist

3. OpenClaw configuration must never point to directories outside the enclave.

4. OpenClaw logs must not contain sensitive data (prompts, source code, secrets).
   Configure log_prompts: false and log_responses: false.

5. If OpenClaw requires a newer version of a dependency that is not yet pinned,
   do NOT run "pip install --upgrade" or "npm update" blindly.
   Follow the Secure Update Procedure in Deliverable I.
```
