# How to Use Distributed Claude Agents

This guide is written for anyone, including non-coders.

## What Is This?

Distributed Claude Agents is a system that takes a task you describe in plain English and breaks it down into steps. A team of specialized AI agents then works on those steps simultaneously, similar to how a software team would collaborate.

## Getting Started

1. Open your web browser
2. Go to `http://localhost:3000`
3. You will see a text box labeled "What would you like done?"

## Submitting a Task

1. Type what you want done in the text box
   - Example: "Review the project files and create a summary"
   - Example: "Add a function that calculates tax rates"
2. Click the "Submit Task" button
3. The system will show you what it understood and its plan

## Watching Progress

After submitting, you will see:

- **Objective**: What the system thinks you want
- **Assumptions**: What it assumed (you can review these)
- **Progress**: A list of steps being worked on
- **Status badges**: Each step shows pending, in progress, or completed

### Simple Mode vs Advanced Mode

Use the toggle at the top of the page:

- **Simple Mode**: Shows just the task input, progress bar, and final result
- **Advanced Mode**: Shows full logs, file changes with diffs, event stream, and all agent artifacts

## Approvals

Some operations need your approval before they proceed:

- **Yellow banner**: Something needs your review. Read what it says and click "Approve" if it looks correct.
- Operations are classified by risk:
  - **SAFE**: Proceeds automatically (reading files, running tests)
  - **CAUTION**: Needs one click to approve (installing packages, renaming files)
  - **DANGEROUS**: Needs careful review (deleting files)

## Reading Results

When the task is done, you get a Result Packet containing:

1. **Summary**: Plain English explanation of what happened
2. **Files Changed**: List of files that were created or modified
3. **Commands Run**: What terminal commands were executed
4. **Test Results**: Whether tests passed or failed
5. **Decisions Made**: Key choices the agents made and why
6. **Next Steps**: Suggestions for what to do next

## Accessibility Features

- **Keyboard Navigation**: Use Tab to move between elements, Enter to select
- **Screen Reader Support**: All elements have proper labels
- **High Contrast Mode**: Select "High Contrast" from the theme dropdown
- **Speakable Summary**: Results include a narration-style summary

## Tips

- Be specific in your requests for better results
- Start with simple tasks to learn how the system works
- Use Advanced Mode to see exactly what each agent did
- Review the audit trail if you want to understand every action taken
