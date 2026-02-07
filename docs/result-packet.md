# Result Packet Template

Every completed task produces a Result Packet with the following structure.

## Format

```json
{
  "summary": "Plain English description of what was accomplished",

  "files_changed": [
    {
      "path": "relative/path/to/file.ts",
      "operation": "create | modify | delete | rename",
      "diff": "unified diff showing changes (optional)"
    }
  ],

  "commands_executed": [
    {
      "command": "the command that was run",
      "exit_code": 0
    }
  ],

  "test_results": [
    {
      "name": "test suite or test name",
      "passed": true,
      "output": "test output (optional)"
    }
  ],

  "decisions_made": [
    {
      "decision": "what was decided",
      "reasoning": "why this choice was made"
    }
  ],

  "remaining_todos": [
    "anything that could not be completed"
  ],

  "next_suggestions": [
    "recommended follow-up actions"
  ]
}
```

## Example

```json
{
  "summary": "Completed 5 of 6 subtasks. Added a dark mode toggle to the settings page with CSS custom properties. All tests pass.",

  "files_changed": [
    {
      "path": "src/components/Settings.tsx",
      "operation": "modify",
      "diff": "--- a/src/components/Settings.tsx\n+++ b/src/components/Settings.tsx\n+ import { ThemeToggle } from './ThemeToggle';\n..."
    },
    {
      "path": "src/components/ThemeToggle.tsx",
      "operation": "create",
      "diff": "+++ b/src/components/ThemeToggle.tsx\n+ export function ThemeToggle() { ... }"
    },
    {
      "path": "src/styles/theme.css",
      "operation": "modify",
      "diff": "..."
    }
  ],

  "commands_executed": [
    { "command": "npm test", "exit_code": 0 },
    { "command": "npx tsc --noEmit", "exit_code": 0 }
  ],

  "test_results": [
    { "name": "ThemeToggle.test.tsx", "passed": true, "output": "3 tests passed" },
    { "name": "Settings.test.tsx", "passed": true, "output": "5 tests passed" }
  ],

  "decisions_made": [
    {
      "decision": "Used CSS custom properties for theming",
      "reasoning": "Maintains compatibility with existing styles, no new dependencies needed"
    },
    {
      "decision": "Stored theme preference in localStorage",
      "reasoning": "Persists across sessions without requiring a backend change"
    }
  ],

  "remaining_todos": [],

  "next_suggestions": [
    "Review the generated diffs and commit if satisfactory",
    "Consider adding a system-preference detection for auto dark mode",
    "Add more test coverage for edge cases"
  ]
}
```

## How Results Are Generated

1. The Orchestrator collects all artifacts from completed subtasks
2. File changes are gathered from the file_changes ledger
3. Commands are gathered from the command_ledger
4. Test results are extracted from QA/Tester agent artifacts
5. Decisions are gathered from the decision_log
6. The Docs/Trainer agent produces the user-friendly summary
7. Failed subtasks become remaining_todos
8. Next suggestions are generated based on task outcome
