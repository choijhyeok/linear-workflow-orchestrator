---
name: linear-workflow-orchestrator
description: Convert a development goal into workflow.md, ask for GitHub and Linear authority, create or dry-run Linear issues, and guide Codex through backlog, execution, review, rework, merge, cancellation, and duplicate handling. Use when the user invokes /linear-workflow-orchestrator or asks to manage Codex development work through Linear.
---

# Linear Workflow Orchestrator

## Purpose

Use this skill when the user wants Codex to turn a development idea into a `workflow.md`, register the work in Linear, and then manage execution status until the work is complete.

The intended command shape is:

```text
/linear-workflow-orchestrator <development goal> [goal mode: on|off]
```

If goal mode is on, keep checking whether more development work remains after the current workflow is complete. When the product is not finished, create the next `workflow.md` slice and continue with the same Linear/status process.

## Startup Questions

Ask these before creating `workflow.md` or doing external writes:

1. Execution workspace:
   - GitHub issue branch flow: create one branch per Linear issue and push each branch/PR.
   - Local worktree flow: create one local worktree per Linear issue when GitHub is not connected or the user wants isolated local execution.
2. Linear credential source:
   - already exported in the shell
   - stored in a user-named env file
   - provided directly by the user for this run
3. Goal mode:
   - on: continue discovering and registering follow-up workflow slices until the product is complete
   - off: stop after this workflow is complete

## Required User Inputs

Confirm these before doing external writes:

- Development goal: what the user wants built.
- GitHub authority: whether Codex may create branches, worktrees, commits, PRs, or merge-related artifacts.
- Linear authority: whether Codex may create or update Linear issues.
- Linear credentials when Linear writes are requested:
  - `LINEAR_API_KEY`
  - `LINEAR_TEAM_ID`
  - `LINEAR_PROJECT_URL` or a project UUID if available

If values are already present in the environment, use them. Do not print secrets.

## Default Status Model

Every workflow starts with these statuses unless the user asks to add more:

| Status | Meaning |
| --- | --- |
| Backlog | All work discovered for the goal before it is selected for execution. |
| Todo | Ready work, including parallel and serial lanes, waiting to start. |
| In Progress | Work actively being implemented by Codex or a subagent. |
| Rework | Follow-up implementation requested after review or failed verification. |
| Review | A review agent checks the developed code and workflow result. |
| Merging | GitHub or local worktree integration, conflict checks, and final merge readiness. |
| Done | Work is implemented, verified, and no longer active. |
| Canceled | Work explicitly canceled by the user or made obsolete by scope changes. |
| Duplicate | Work excluded because another issue already covers it. |

## Workflow

1. Restate the development goal and authority assumptions.
2. Create or update `workflow.md` at the repository root.
3. Record startup answers before creating Linear issues or starting work:

```bash
node plugins/linear-workflow-orchestrator/scripts/linear-workflow-orchestrator.mjs record-preflight workflow.md --workspace github --credentials exported --goal-mode off
```

4. Include:
   - goal mode value
   - GitHub/Linear authority checklist
   - credential sources without secret values
   - status model
   - execution table with issue IDs, titles, lane type, dependencies, status, Linear issue, Branch/Worktree, and acceptance criteria
   - goal-mode continuation gate
5. If Linear writes are authorized and credentials exist, run:

```bash
node plugins/linear-workflow-orchestrator/scripts/linear-workflow-orchestrator.mjs sync-linear workflow.md --apply
```

6. If Linear writes are not authorized or credentials are missing, run a dry-run instead:

```bash
node plugins/linear-workflow-orchestrator/scripts/linear-workflow-orchestrator.mjs sync-linear workflow.md --dry-run-out linear-issues.preview.json
```

7. After Linear backlog registration, do not implement directly on `main`.
8. Use the issue dependency graph:
   - run `ready` to identify Backlog/Todo issues whose dependencies are Done
   - run `wave` to identify dependency-ready parallel issues that can be assigned together
   - move only the selected ready issue or ready parallel wave into execution
   - for serial lanes, start one issue at a time
   - for parallel lanes, start all dependency-satisfied parallel siblings together when the user wants Symphony-style concurrent Codex work
9. Select work before starting it:

```bash
node plugins/linear-workflow-orchestrator/scripts/linear-workflow-orchestrator.mjs select-issue workflow.md LWO-004
```

10. For each started issue, run `start-issue` to record the branch/worktree and move it to In Progress:

```bash
node plugins/linear-workflow-orchestrator/scripts/linear-workflow-orchestrator.mjs start-issue workflow.md LWO-004 --mode github --checkout
node plugins/linear-workflow-orchestrator/scripts/linear-workflow-orchestrator.mjs start-issue workflow.md LWO-004 --mode worktree --worktree-dir ../project-HOW-76 --checkout
```

11. For Symphony-style concurrent work:
   - assign each ready parallel issue to a separate Codex session/subagent/worktree
   - each Codex lane owns exactly one Linear issue and its branch/worktree
   - no lane may edit another lane's owned files unless the orchestrator updates the workflow
   - merge only after all parallel lane reviews pass
12. Move implemented work to Review and use a different Codex agent/session as reviewer.
13. Move review failures to Rework and keep the issue branch/worktree active until fixed.
14. Move accepted work to Merging only after review passes; `set-status ... Merging` requires `--reviewed-by`.
15. Merge using the issue branch/PR or local worktree integration branch, never by committing unrelated completed work directly to `main`.
16. Mark obsolete work as Canceled or Duplicate.
17. Before claiming completion, audit all workflow acceptance criteria and Linear issue statuses.
18. In goal mode, create a follow-up workflow when the current audit finds remaining product work.

## Helper CLI

The helper script can initialize a deterministic workflow template and parse/sync existing `workflow.md` files:

```bash
node plugins/linear-workflow-orchestrator/scripts/linear-workflow-orchestrator.mjs init "Build a Codex plugin" --goal-mode on --out workflow.md
node plugins/linear-workflow-orchestrator/scripts/linear-workflow-orchestrator.mjs preflight
node plugins/linear-workflow-orchestrator/scripts/linear-workflow-orchestrator.mjs record-preflight workflow.md --workspace github --credentials exported --goal-mode on
node plugins/linear-workflow-orchestrator/scripts/linear-workflow-orchestrator.mjs parse workflow.md
node plugins/linear-workflow-orchestrator/scripts/linear-workflow-orchestrator.mjs sync-linear workflow.md --dry-run-out linear-issues.preview.json
node plugins/linear-workflow-orchestrator/scripts/linear-workflow-orchestrator.mjs ready workflow.md
node plugins/linear-workflow-orchestrator/scripts/linear-workflow-orchestrator.mjs wave workflow.md
node plugins/linear-workflow-orchestrator/scripts/linear-workflow-orchestrator.mjs select-issue workflow.md LWO-004
node plugins/linear-workflow-orchestrator/scripts/linear-workflow-orchestrator.mjs start-issue workflow.md LWO-004 --mode github --checkout
node plugins/linear-workflow-orchestrator/scripts/linear-workflow-orchestrator.mjs start-issue workflow.md LWO-004 --mode worktree --worktree-dir ../project-HOW-76 --checkout
node plugins/linear-workflow-orchestrator/scripts/linear-workflow-orchestrator.mjs set-status workflow.md LWO-004 Review
node plugins/linear-workflow-orchestrator/scripts/linear-workflow-orchestrator.mjs set-status workflow.md LWO-004 Merging --reviewed-by codex-reviewer
LINEAR_API_KEY=... LINEAR_TEAM_ID=... node plugins/linear-workflow-orchestrator/scripts/linear-workflow-orchestrator.mjs set-status workflow.md LWO-004 Review --linear-issue ABC-123 --apply-linear
node plugins/linear-workflow-orchestrator/scripts/linear-workflow-orchestrator.mjs statusline workflow.md
```

The agent should still refine `workflow.md` with domain-specific tasks before creating Linear issues. Active implementation must be selected with `select-issue` before `start-issue`.

## Terminal Status Line

To show the current Linear stage and task title under the Codex CLI composer, use the helper's status-line output:

```bash
node plugins/linear-workflow-orchestrator/scripts/linear-workflow-orchestrator.mjs statusline workflow.md
```

Example:

```text
Linear In Progress: LWO-004 Execute independent implementation lanes · ABC-123
```

The command reads `workflow.md` and chooses the most active issue in this priority order: In Progress, Rework, Review, Merging, Todo, Backlog. Plugin installation exposes this command, while actual native TUI status-line registration remains owned by the host Codex/OMX setup.

## Linear API Notes

Linear uses a GraphQL endpoint at `https://api.linear.app/graphql`. Personal API keys are sent as `Authorization: <API_KEY>`; OAuth access tokens use `Authorization: Bearer <ACCESS_TOKEN>`. `issueCreate` requires `teamId` and `title`; if no `stateId` is provided, Linear assigns the team's first Backlog/Triage state. This skill attempts to find a team state named `Backlog` and uses it when available.
