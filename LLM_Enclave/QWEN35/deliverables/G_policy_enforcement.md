# DELIVERABLE G: Policy File and Enforcement

## Policy File Location

```
D:\ProjectsHome\LLM_Enclave\QWEN35\policies\bridge_policy.yaml
```

(Full content generated as file H6)

## Policy Fields

### G1. Allowed Target Roots

```yaml
allowed_target_roots: []
# Initially EMPTY. The system refuses all apply operations until the user
# explicitly adds at least one target root.
#
# To enable a project for bridge integration:
#   allowed_target_roots:
#     - "D:\\ProjectsHome\\MyProject"
#     - "D:\\ProjectsHome\\AnotherProject"
#
# RULES:
# - Each entry must be an absolute path.
# - Each entry must be under D:\ProjectsHome.
# - Paths outside D:\ProjectsHome are always rejected regardless of this list.
# - The apply script validates every target path against this list before any operation.
```

### G2. Allowed File Extensions

```yaml
allowed_extensions:
  - ".py"
  - ".js"
  - ".ts"
  - ".jsx"
  - ".tsx"
  - ".html"
  - ".css"
  - ".scss"
  - ".less"
  - ".json"
  - ".yaml"
  - ".yml"
  - ".md"
  - ".txt"
  - ".toml"
  - ".cfg"
  - ".ini"
  - ".sh"
  - ".ps1"
  - ".bat"
  - ".cmd"
  - ".rs"
  - ".go"
  - ".java"
  - ".xml"
  - ".sql"
  - ".r"
  - ".rmd"
  - ".vue"
  - ".svelte"
  - ".astro"
  - ".patch"
  - ".diff"
```

### G3. Size Limits

```yaml
max_file_size_bytes: 1048576        # 1 MB per individual file
max_batch_size_bytes: 10485760      # 10 MB total per apply operation
```

### G4. Deny Patterns

```yaml
deny_patterns:
  # Cryptographic keys and certificates
  - '.*\.key$'
  - '.*\.pem$'
  - '.*\.pfx$'
  - '.*\.p12$'
  - '.*\.cer$'
  - '.*\.crt$'
  - '.*\.jks$'
  - '.*\.keystore$'

  # Environment and secret files
  - '.*\.env$'
  - '.*\.env\..*'
  - '.*\.secret$'
  - '.*\.secrets$'

  # Password and credential files
  - '.*password.*'
  - '.*credential.*'
  - '.*\.htpasswd$'
  - '.*\.netrc$'
  - '.*\.pgpass$'

  # Token and auth files
  - '.*token.*\.json$'
  - '.*token.*\.txt$'
  - '.*\.npmrc$'
  - '.*\.pypirc$'

  # SSH keys
  - '.*id_rsa.*'
  - '.*id_ed25519.*'
  - '.*id_ecdsa.*'
  - '.*id_dsa.*'
  - '.*authorized_keys$'
  - '.*known_hosts$'

  # Cloud provider credentials
  - '.*aws.*credentials.*'
  - '.*\.azure.*'
  - '.*gcloud.*'
  - '.*service.account.*\.json$'

  # Database files
  - '.*\.sqlite$'
  - '.*\.db$'
  - '.*\.mdb$'

  # Binary and compiled files
  - '.*\.exe$'
  - '.*\.dll$'
  - '.*\.so$'
  - '.*\.dylib$'
  - '.*\.bin$'
  - '.*\.obj$'
  - '.*\.o$'
  - '.*\.class$'
  - '.*\.pyc$'
  - '.*\.pyo$'
```

### G5. Redaction Rules for Common Secret Formats

```yaml
redaction_rules:
  - name: "AWS Access Key"
    pattern: 'AKIA[0-9A-Z]{16}'
    replacement: "[REDACTED:aws_access_key]"

  - name: "AWS Secret Key"
    pattern: '(?i)(aws_secret_access_key|aws_secret)\s*[=:]\s*\S+'
    replacement: "[REDACTED:aws_secret_key]"

  - name: "GitHub Token"
    pattern: 'gh[pousr]_[A-Za-z0-9_]{36,}'
    replacement: "[REDACTED:github_token]"

  - name: "Generic API Key Value"
    pattern: '(?i)(api[_-]?key|apikey)\s*[=:]\s*["\x27]?[A-Za-z0-9\-._]{20,}'
    replacement: "[REDACTED:api_key]"

  - name: "Generic Password Value"
    pattern: '(?i)(password|passwd|pwd)\s*[=:]\s*["\x27]?\S{8,}'
    replacement: "[REDACTED:password]"

  - name: "Generic Secret Value"
    pattern: '(?i)(secret|token|auth)\s*[=:]\s*["\x27]?\S{16,}'
    replacement: "[REDACTED:secret]"

  - name: "Private Key Block"
    pattern: '-----BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----'
    replacement: "[REDACTED:private_key_block]"

  - name: "Connection String with Password"
    pattern: '(?i)(server|host|data source)=[^;]+;.*(password|pwd)=[^;]+'
    replacement: "[REDACTED:connection_string]"

  - name: "Bearer Token"
    pattern: '(?i)bearer\s+[A-Za-z0-9\-._~+/]{20,}=*'
    replacement: "[REDACTED:bearer_token]"

  - name: "Basic Auth Header"
    pattern: '(?i)basic\s+[A-Za-z0-9+/]{20,}=*'
    replacement: "[REDACTED:basic_auth]"

  - name: "JWT Token"
    pattern: 'eyJ[A-Za-z0-9\-_]+\.eyJ[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_.+/=]+'
    replacement: "[REDACTED:jwt_token]"
```

### G6. Logging Configuration

```yaml
logging:
  level: "INFO"  # Options: DEBUG, INFO, WARN, ERROR
  # What IS safe to log:
  safe_to_log:
    - "file paths (source and target)"
    - "file sizes"
    - "operation type (export, apply, diff)"
    - "timestamps"
    - "user confirmations"
    - "hash values"
    - "policy violations"
    - "error messages (without file contents)"

  # What is NOT safe to log:
  never_log:
    - "file contents"
    - "prompt text"
    - "model responses"
    - "source code snippets"
    - "diff content (store in separate diff files, not in main log)"
    - "secret values"
    - "credentials"

  log_directory: "D:\\ProjectsHome\\LLM_Enclave\\QWEN35\\logs"
  max_log_file_size_mb: 50
  log_rotation: "manual"  # No automatic rotation to avoid data loss
```

### G7. Default Mode

```yaml
# CRITICAL SAFETY DEFAULT
# The system will REFUSE all apply operations when this is true.
# You must set this to false AND add at least one allowed_target_root
# before the apply script will function.
policy_not_configured: true

# When policy_not_configured is true:
# - 04_export_to_bridge.ps1: WORKS (exports are safe, they are copies)
# - 05_apply_changes.ps1: REFUSES (will not apply anything)
# - Bridge read/write: WORKS (within bridge directories only)
#
# To activate:
# 1. Review this entire policy file.
# 2. Add your project paths to allowed_target_roots.
# 3. Set policy_not_configured to false.
# 4. Save the file.
```

## Enforcement Architecture

```
User runs script
       |
       v
[Load bridge_policy.yaml]
       |
       v
[Check policy_not_configured == true?] --YES--> REFUSE with message
       |
       NO
       v
[Validate target path against allowed_target_roots] --FAIL--> REFUSE
       |
       PASS
       v
[Check file extensions against allowed_extensions] --FAIL--> REFUSE
       |
       PASS
       v
[Check file against deny_patterns] --MATCH--> REFUSE
       |
       NO MATCH
       v
[Check file size against max_file_size_bytes] --EXCEED--> REFUSE
       |
       UNDER LIMIT
       v
[Run secret scanning with redaction_rules] --FOUND + mode=block--> REFUSE
       |                                    --FOUND + mode=redact--> REDACT AND CONTINUE
       |                                    --FOUND + mode=warn--> WARN AND CONTINUE
       NO MATCH
       v
[Proceed with operation]
       |
       v
[Log action to audit trail]
```
