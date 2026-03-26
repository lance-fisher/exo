# Agent Offline Behavior Policy

## Overview

This document specifies the complete behavior of the system when the local agent is disconnected from the broker. The agent connects to the broker via an outbound WebSocket over mutual TLS. This connection can be interrupted for various reasons, and the system must handle each scenario safely.

## Connection States

```
CONNECTED    → Agent WebSocket is open, heartbeats succeeding
DEGRADED     → Heartbeat missed (1 cycle), connection may be unstable
DISCONNECTED → WebSocket closed or 3+ heartbeats missed
RECONNECTING → Agent is attempting to re-establish connection
```

### Heartbeat Protocol

- Agent sends a WebSocket ping every 30 seconds.
- Broker expects a ping within 45 seconds (30s interval + 15s grace).
- If no ping received in 45 seconds: state transitions to `DEGRADED`.
- If no ping received in 90 seconds (3 missed cycles): state transitions to `DISCONNECTED`.
- Broker sends connection state changes to the Console UI via WebSocket push.

## Disconnection Scenarios

| Scenario | Detection Time | Expected Duration | Recovery |
|---|---|---|---|
| Brief network glitch | 45-90 seconds | Seconds | Automatic reconnect |
| Wi-Fi disconnect | 45-90 seconds | Minutes | Automatic after Wi-Fi restored |
| VPN toggle | 45-90 seconds | Seconds-minutes | Automatic |
| Workstation sleep | 45-90 seconds | Minutes-hours | Automatic on wake |
| Workstation reboot | 45-90 seconds | 2-5 minutes | WinSW auto-restart |
| Agent crash | 45-90 seconds | 10-60 seconds | WinSW crash recovery |
| Broker restart/deploy | Immediate (WebSocket close) | 30-120 seconds | Agent retry loop |
| Prolonged outage | 45-90 seconds | Hours-days | Manual intervention |

## Agent-Side Behavior

### Reconnection Strategy

```typescript
const reconnectConfig = {
  initialDelay: 1000,        // 1 second
  maxDelay: 60000,           // 60 seconds
  backoffMultiplier: 2,      // Exponential backoff
  jitter: true,              // +-20% random jitter to prevent thundering herd
  maxAttempts: Infinity,     // Never stop trying
  resetAfterSuccess: true,   // Reset backoff counter on successful reconnect
};
```

### Local Behavior During Disconnection

- Agent continues running as a Windows service.
- Agent does **not** execute any queued tasks locally during disconnection.
- Agent does **not** accept any new tasks from any source during disconnection.
- Agent logs disconnection events locally (file-based log, not dependent on broker).
- Agent preserves its mTLS client certificate and reconnection credentials.

## Broker-Side Behavior

### Task Queue

When a task is submitted while the agent is disconnected:

```typescript
interface QueuedTask {
  id: string;                    // UUIDv4
  task_payload: object;          // Full task specification
  status: 'queued' | 'confirmed' | 'executing' | 'completed' | 'expired' | 'discarded';
  created_at: string;            // ISO 8601
  ttl_expires_at: string;        // ISO 8601
  confirmed_at: string | null;   // Set when operator re-confirms after reconnect
  executed_at: string | null;
  result: object | null;
}
```

### TTL Values

| Task Type | TTL | Rationale |
|---|---|---|
| Read-only (file listing, status) | 10 minutes | Low risk, stable intent |
| Write (file modification) | 5 minutes | Context may change |
| Delete | 5 minutes | Destructive, context-sensitive |
| Execute (command, task) | 5 minutes | Arbitrary execution |
| Config change | 5 minutes | System state sensitive |

### TTL Expiration

A background job runs every 30 seconds:

```sql
UPDATE queued_tasks
SET status = 'expired'
WHERE status = 'queued'
  AND ttl_expires_at < NOW();
```

Expired tasks trigger a UI notification: "Task [summary] expired — agent did not reconnect in time."

## Reconnection Protocol

When the agent reconnects:

```
1. Agent establishes WebSocket with mTLS client certificate
2. Broker validates client certificate against enrolled device registry
3. Broker transitions agent state to CONNECTED
4. Broker checks for queued tasks with status = 'queued' (non-expired)
5. If queued tasks exist:
   a. Broker sends RECONFIRMATION_REQUIRED event to Console UI
   b. UI displays: "Agent reconnected. [N] tasks require re-confirmation."
   c. For each queued task, UI shows:
      - Task description
      - Original submission time
      - Time remaining before TTL expiry
      - Buttons: [Confirm] [Discard]
   d. Operator reviews each task individually
   e. Confirmed tasks: status → 'confirmed', sent to agent
   f. Discarded tasks: status → 'discarded'
6. If no queued tasks: normal operation resumes immediately
7. Audit log entries for: AGENT_RECONNECTED, each TASK_RECONFIRMED or TASK_DISCARDED
```

### Debouncing

If the agent rapidly disconnects and reconnects (flapping):

- Broker waits 5 seconds after reconnection before presenting queued tasks.
- If the agent disconnects again within 5 seconds, the reconnection event is suppressed.
- Flapping detection: 3+ disconnections in 2 minutes triggers an alert to the operator.

## Console UI Indicators

### Connection Status Display

The Console UI shows a persistent connection status indicator:

| State | Indicator | Color |
|---|---|---|
| CONNECTED | Solid circle | Green |
| DEGRADED | Pulsing circle | Yellow |
| DISCONNECTED | Hollow circle | Red |
| RECONNECTING | Spinning circle | Yellow |

### Task Submission UX During Disconnection

When the agent is disconnected and the operator submits a task:

```
1. UI displays warning: "Agent is currently offline. This task will be queued."
2. UI shows the TTL: "Task will expire if agent does not reconnect within [TTL]."
3. Operator can:
   a. Submit anyway → task queued at broker
   b. Cancel → task not created
4. After submission, UI shows task with status "Queued (awaiting agent)"
5. If task expires, UI updates to "Expired — agent did not reconnect in time"
```

## Edge Cases

### Task In-Flight During Disconnection

If the agent disconnects while a task is executing:

1. Agent continues executing the task locally (subprocess is independent of WebSocket).
2. When the task completes, agent buffers the result locally.
3. On reconnect, agent sends the buffered result to the broker.
4. Broker matches the result to the original task and updates status.
5. If the result arrives after the broker-side TTL, the broker still accepts it (the task was already dispatched, TTL applies to queued-not-dispatched tasks only).

### Broker Restart

If the broker restarts:

1. All WebSocket connections are dropped.
2. Agent detects disconnection and enters reconnection loop.
3. Broker recovers session state from PostgreSQL.
4. Queued tasks in PostgreSQL survive the restart.
5. Normal reconnection protocol resumes.

### Simultaneous UI and Agent Disconnection

If the operator's browser also loses connection:

1. Queued tasks remain in PostgreSQL.
2. When either the UI or agent reconnects first, state is consistent.
3. No tasks are lost unless TTL expires.
