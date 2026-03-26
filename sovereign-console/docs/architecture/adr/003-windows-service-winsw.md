# ADR-003: Windows Service Management via WinSW

## Status

**Accepted**

## Context

The local agent must run as a Windows service so that it:

1. Starts automatically on boot
2. Reconnects to the broker after crashes or restarts
3. Runs under a dedicated service account (not the interactive user session)
4. Has proper log management
5. Can be managed via standard Windows service tools (services.msc, sc.exe)

Three options were evaluated:

### Option 1: NSSM (Non-Sucking Service Manager)

A widely-used tool for wrapping executables as Windows services.

**Pros:**
- Well-known, many community guides
- GUI editor for service configuration
- Supports stdout/stderr log redirection
- Handles process restart on crash

**Cons:**
- **Not actively maintained**: Last release was 2017 (v2.24). No updates in 9+ years.
- **No signed binary**: The distributed executable is unsigned, which triggers Windows SmartScreen warnings and raises concerns for a security-focused system.
- **External dependency**: Must be downloaded and placed on PATH or alongside the application.
- **Limited configuration**: No native support for environment variable files, delayed start, or complex restart policies.
- **Registry-based config**: Service parameters are stored in the Windows registry, which is harder to version control and audit than a config file.

### Option 2: WinSW (Windows Service Wrapper)

A .NET-based service wrapper that uses an XML configuration file.

**Pros:**
- **Pure .NET implementation**: Runs on .NET Framework (pre-installed on all modern Windows) or .NET 6+. No external native dependencies.
- **XML configuration**: All service parameters in a single XML file, easy to version control, review, and audit.
- **Built-in crash recovery**: `<onfailure>` element supports configurable restart delays, reset periods, and failure actions.
- **Active maintenance**: Regular releases, active GitHub repository (winsw/winsw), responsive to issues.
- **Signed releases**: Available as signed .NET executables.
- **Log rotation**: Built-in log rotation with configurable size limits and retention.
- **Environment variables**: Native support for `<env>` elements in config.
- **Delayed start**: Supports `<delayedAutoStart>` for boot-time dependency ordering.
- **Self-contained**: Single executable + XML config. No installer, no registry hacks.

**Cons:**
- Requires .NET Framework 4.6.1+ or .NET 6+ runtime (virtually always present on Windows 10/11).
- XML config is verbose compared to command-line flags.

### Option 3: Native Windows Service API (via node-windows or custom C# wrapper)

Implement the service directly using the Windows Service Control Manager API.

**Pros:**
- No external wrapper process
- Direct integration with SCM events (start, stop, pause, custom commands)
- Most "native" approach

**Cons:**
- **Significant development effort**: Must implement the SCM integration, including service lifecycle callbacks, error handling, and recovery logic.
- **node-windows package concerns**: The npm `node-windows` package is sparsely maintained, has open issues with Node.js version compatibility, and wraps NSSM internally in some configurations.
- **Custom C# wrapper**: Writing a custom wrapper in C# is robust but adds a second language/build system to the project and requires ongoing maintenance.
- **Testing burden**: Service lifecycle edge cases (crash recovery, delayed start, account permissions) must all be tested manually.

## Decision

**WinSW.**

The agent will be deployed as a WinSW-managed Windows service with the following configuration:

```xml
<service>
  <id>sovereign-agent</id>
  <name>Sovereign Operator Agent</name>
  <description>Local agent for Sovereign Operator Console - connects to broker and executes tasks via Claude Code</description>
  <executable>node</executable>
  <arguments>"%BASE%\dist\agent.js"</arguments>
  <workingdirectory>%BASE%</workingdirectory>

  <log mode="roll-by-size">
    <sizeThreshold>10240</sizeThreshold>
    <keepFiles>5</keepFiles>
  </log>

  <onfailure action="restart" delay="10 sec" />
  <onfailure action="restart" delay="30 sec" />
  <onfailure action="restart" delay="60 sec" />
  <resetfailure>1 hour</resetfailure>

  <delayedAutoStart>true</delayedAutoStart>
  <stopparentprocessfirst>true</stopparentprocessfirst>

  <env name="NODE_ENV" value="production" />
  <env name="AGENT_CONFIG" value="%BASE%\config\agent.json" />

  <serviceaccount>
    <username>.\SovereignAgent</username>
    <password>REDACTED</password>
    <allowservicelogon>true</allowservicelogon>
  </serviceaccount>
</service>
```

## Consequences

### Positive

- **Zero external dependencies**: WinSW is a single executable. .NET Framework is pre-installed on Windows 10/11.
- **Auditable configuration**: XML config file is version-controlled alongside the agent code. Changes are visible in git history.
- **Robust crash recovery**: Three-tier restart policy (10s, 30s, 60s) with hourly failure counter reset handles transient issues without rapid restart loops.
- **Standard service management**: Appears as a normal Windows service. Can be managed via `services.msc`, `sc.exe`, `Get-Service` PowerShell, etc.
- **Clean log management**: Built-in log rotation prevents disk exhaustion.

### Negative

- **Wrapper process overhead**: WinSW runs as a thin wrapper around the Node.js process. Overhead is negligible (<5MB RAM).
- **XML verbosity**: Configuration is more verbose than a simple command line. Acceptable tradeoff for clarity and auditability.
- **Update responsibility**: Must track WinSW releases for security fixes. Mitigated by: WinSW is stable and changes infrequently.
