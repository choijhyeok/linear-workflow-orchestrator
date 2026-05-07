# Workflow: Build a Linear-managed Codex plugin

## Goal

Build a Codex plugin that writes workflow.md, creates Linear issues, and manages execution statuses.

## Mode

- Goal mode: on

## Authority Checklist

- [x] GitHub authority confirmed for branches, worktrees, commits, PRs, and merge checks.
- [ ] Linear authority confirmed for issue creation and status updates.
- [ ] `LINEAR_API_KEY` source confirmed without exposing the secret.
- [ ] `LINEAR_TEAM_ID` confirmed.
- [ ] `LINEAR_PROJECT_URL` or project UUID confirmed when project attachment is required.

## Status Model

| Status | Meaning |
| --- | --- |
| Backlog | All discovered work before it is selected for execution. |
| Todo | Ready work, including parallel and serial lanes, waiting to start. |
| In Progress | Work actively being implemented. |
| Rework | Follow-up implementation requested after review or failed verification. |
| Review | Review agent checks the developed code and workflow result. |
| Merging | GitHub or local worktree integration and merge readiness. |
| Canceled | Work explicitly canceled or made obsolete by scope changes. |
| Duplicate | Work excluded because another issue already covers it. |

## Execution Plan

| ID | Title | Lane | Depends On | Status | Linear Issue | Acceptance Criteria |
| --- | --- | --- | --- | --- | --- | --- |
| LWO-001 | Create plugin manifest and skill | serial | - | Backlog | - | Codex can discover the plugin and route the skill. |
| LWO-002 | Implement workflow helper CLI | serial | LWO-001 | Backlog | - | CLI can init, parse, and dry-run Linear payloads. |
| LWO-003 | Add verification tests | parallel | LWO-002 | Backlog | - | Parser and Linear payload tests pass. |

## Goal Mode Continuation Gate

- [ ] Current workflow acceptance criteria are complete.
- [ ] Review/rework loop has no open findings.
- [ ] Merge readiness is verified.
- [ ] If goal mode is on, Codex has checked whether another workflow slice is needed.
