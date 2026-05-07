# Workflow: Dogfood plugin with bookmark CLI and public GitHub delivery

## Goal

Use the Linear Workflow Orchestrator plugin to build and ship a real bookmark CLI with `add`, `list`, and `remove` commands. Register the work in Linear, push the plugin repository to GitHub, and merge it so other Codex users can install and use the plugin from `https://github.com/choijhyeok/linear-workflow-orchestrator`.

## Mode

- Goal mode: off

## Authority Checklist

- [x] GitHub authority granted for branches, commits, push, PR, and merge checks for `choijhyeok/linear-workflow-orchestrator`.
- [x] Linear authority granted for issue creation and status updates.
- [x] `LINEAR_API_KEY` source provided by user; secret value must not be printed.
- [x] `LINEAR_TEAM_ID` provided by user.
- [x] `LINEAR_PROJECT_URL` provided by user; helper resolves slug-only project URLs through Linear API when applying.

## Status Model

| Status | Meaning |
| --- | --- |
| Backlog | All discovered work before it is selected for execution. |
| Todo | Ready work, including parallel and serial lanes, waiting to start. |
| In Progress | Work actively being implemented. |
| Rework | Follow-up implementation requested after review or failed verification. |
| Review | Review agent checks the developed code and workflow result. |
| Merging | GitHub or local worktree integration and merge readiness. |
| Done | Work is implemented, verified, and no longer active. |
| Canceled | Work explicitly canceled or made obsolete by scope changes. |
| Duplicate | Work excluded because another issue already covers it. |

## Execution Plan

| ID | Title | Lane | Depends On | Status | Linear Issue | Acceptance Criteria |
| --- | --- | --- | --- | --- | --- | --- |
| LWO-001 | Register bookmark CLI workflow in Linear | serial | - | Done | HOW-73 | Linear issues exist for the real dogfood workflow and workflow.md contains their identifiers. |
| LWO-002 | Build bookmark CLI example | serial | LWO-001 | Done | HOW-74 | `examples/bookmark-cli` supports `add`, `list`, and `remove` using a persistent JSON store. |
| LWO-003 | Verify plugin installability and CLI behavior | serial | LWO-002 | Done | HOW-75 | Automated tests cover plugin helper behavior plus bookmark add/list/remove behavior. |
| LWO-004 | Document GitHub installation path for other Codex users | parallel | LWO-002 | Done | HOW-76 | README and install docs explain GitHub marketplace registration and local installation. |
| LWO-005 | Push and merge GitHub delivery | serial | LWO-003, LWO-004 | Done | HOW-77 | Changes are committed, pushed to GitHub, reviewed by checks, and merged to the repository default branch. |

## Goal Mode Continuation Gate

- [x] Current workflow acceptance criteria are complete.
- [x] Review/rework loop has no open findings.
- [x] Merge readiness is verified.
- [x] Goal mode is off for this dogfood run.
