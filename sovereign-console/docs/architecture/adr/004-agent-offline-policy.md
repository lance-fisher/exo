# ADR-004: Agent Offline Policy — Queue with TTL and Reconfirmation

## Status

**Accepted**

## Context

The local agent connects to the broker via an outbound WebSocket. This connection can drop due to:

- Network interruption (ISP outage, Wi-Fi disconnect, VPN toggle)
- Workstation sleep/hibernate
- Agent service restart or crash
- Workstation reboot
- Broker restart or deployment

When the agent is offline, the operator may still submit tasks via the Console UI. We must define what happens to those tasks.

### Options Evaluated

**Option A: Immediate rejection** — Reject any task submitted while agent is offline. Operator is told "agent unavailable, try later."

- Pros: Simple, no ambiguity, no stale execution risk
- Cons: Poor UX when agent is briefly offline (e.g., during a reboot). Operator must retry manually.

**Option B: Unbounded queue** — Queue tasks indefinitely until agent reconnects, then execute them all automatically.

- Pros: No task loss, operator never needs to resubmit
- Cons: **Dangerous.** Tasks queued hours ago may no longer be appropriate. Context may have changed. Automatic execution of stale tasks violates the principle of operator control.

**Option C: Queue with TTL and reconfirmation** — Queue tasks at the broker with a time-to-live. If the agent reconnects within the TTL, present queued tasks to the operator for re-confirmation before execution. If TTL expires, mark the task as expired.

- Pros: Handles brief disconnections gracefully, preserves operator control, prevents stale execution
- Cons: Slightly more complex than immediate rejection

## Decision

**Option C: Queue with TTL and operator reconfirmation on reconnect.**

### Behavior

1. **Task submission while offline**: Broker accepts the task, stores it in the queue with status `queued` and a TTL timestamp.

2. **TTL values**:
   - Default: 5 minutes
   - Read-only tasks: 10 minutes
   - Write/delete/execute tasks: 5 minutes
   - Configurable per-task via UI (operator can set shorter TTL)

3. **Agent reconnects within TTL**:
   - Broker notifies operator via UI: "Agent reconnected. N tasks are queued and awaiting re-confirmation."
   - Operator reviews each queued task and explicitly confirms or discards.
   - Confirmed tasks are sent to agent for execution.
   - Discarded tasks are marked `discarded`.

4. **TTL expires before reconnect**:
   - Task status set to `expired`.
   - Operator is notified: "Task [id] expired — agent did not reconnect within [TTL]."
   - Operator must resubmit if still needed.

5. **Agent reconnects after TTL**:
   - Expired tasks are NOT presented for re-confirmation. They are gone.
   - Only non-expired queued tasks are presented.

6. **No automatic execution**: Tasks are **never** automatically executed after a disconnection event. The reconnect always requires human re-confirmation, even if TTL has not expired. This is a hard rule.

### Queue Storage

- Queued tasks are stored in PostgreSQL (not Redis) to survive broker restarts.
- Schema: `queued_tasks(id, task_payload, status, created_at, ttl_expires_at, confirmed_at, executed_at)`
- Status values: `queued`, `confirmed`, `executing`, `completed`, `expired`, `discarded`

## Consequences

### Positive

- **Operator control preserved**: No task executes without explicit human confirmation after a disconnect.
- **Brief disconnections handled gracefully**: A 30-second network blip does not force the operator to resubmit.
- **Stale execution prevented**: TTL ensures old tasks do not linger indefinitely.
- **Full auditability**: Queue status transitions are logged in the audit trail.

### Negative

- **Operator friction on reconnect**: Must review and confirm queued tasks. Acceptable cost for safety.
- **Complexity**: More state management than immediate rejection. Justified by improved UX and safety.
- **Edge case: rapid disconnect/reconnect cycles**: Could result in repeated re-confirmation prompts. Mitigated by: debouncing reconnect events (wait 5 seconds after reconnect before presenting queue).
