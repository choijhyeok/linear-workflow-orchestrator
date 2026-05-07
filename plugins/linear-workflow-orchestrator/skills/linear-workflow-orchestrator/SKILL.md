---
name: linear-workflow-orchestrator
description: Convert a development goal into workflow.md, ask for GitHub and Linear authority, create or dry-run Linear issues, and guide Codex through backlog, execution, review, rework, merge, cancellation, and duplicate handling. Use when the user invokes $linear-workflow-orchestrator or asks to manage Codex development work through Linear.
---

# Linear Workflow Orchestrator

## Purpose

Use this skill when the user wants Codex to turn a development idea into a `workflow.md`, register the work in Linear, and then manage execution status until the work is complete.

The intended command shape is:

```text
$linear-workflow-orchestrator <development goal> [goal mode: on|off]
```

If goal mode is on, keep checking whether more development work remains after the current workflow is complete. When the product is not finished, create the next `workflow.md` slice and continue with the same Linear/status process.

Goal mode bypass: when goal mode is on and the user has granted GitHub/Linear authority, proceed autonomously through Linear registration, Todo/In Progress execution, workpad updates, review, rework, PR creation, and merge-readiness checks without asking "continue?" between routine steps. Ask only for missing credentials, destructive actions outside the granted authority, irreversible production effects, or materially new scope.

## Startup Questions

Hard gate: ask these four questions before repository inspection, creating `workflow.md`, running `git`, running implementation commands, or doing external writes. Do not infer or auto-select the answers from the current directory, environment, or perceived user intent. If the user supplied one answer inline, ask only for the missing answers.

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
4. Agent limits:
   - `max_concurrent_agents`: maximum Linear issues the terminal TUI may dispatch at once
   - `max_turns`: per-issue Codex lane turn budget passed to the runner

The first assistant response for a new `$linear-workflow-orchestrator` request must be only the startup-question prompt plus a short statement that no workflow work will start until those answers are recorded. Do not say that goal mode is off, Linear is local-only, or GitHub is unavailable unless the user explicitly answered that way.

Suggested Korean prompt shape:

```text
시작 전에 4가지만 정하겠습니다.

1. 실행 방식: GitHub issue branch / local worktree 중 무엇으로 할까요?
2. Linear 인증: 이미 export됨 / env 파일 경로 제공 / 지금 입력 중 무엇인가요?
3. goal mode: on / off 중 무엇으로 할까요?
4. agent limit: max_concurrent_agents와 max_turns를 몇으로 할까요? 예: 10 agents / 20 turns
```

## Required User Inputs

Confirm these before doing external writes:

- Development goal: what the user wants built.
- GitHub authority: whether Codex may create branches, worktrees, commits, PRs, or merge-related artifacts.
- Linear authority: whether Codex may create or update Linear issues.
- Linear credentials when Linear writes are requested:
  - `LINEAR_API_KEY`
  - `LINEAR_TEAM_ID` when available; otherwise the helper can resolve the first visible team from the API key
  - `LINEAR_PROJECT_URL` or a project UUID when available; otherwise the helper can create a Linear project for the workflow during `sync-linear --apply`

If values are already present in the environment, use them. Do not print secrets.

If only `LINEAR_API_KEY` is present and Linear writes are authorized, do not stop for `LINEAR_TEAM_ID` or `LINEAR_PROJECT_URL`. Run `sync-linear --apply`; it resolves the first visible team and creates a workflow project when no project URL is provided. Stop only if the API key cannot see any teams or project creation fails.

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

Goal-mode execution has two surfaces:

- Codex CLI: asks the four startup questions, creates `WORKFLOW.md`, registers Linear backlog/project once, and handles user-facing review decisions.
- Terminal TUI: owns the Linear execution queue after bootstrap. It claims Todo issues, moves them to In Progress, runs lanes up to `agent.max_concurrent_agents`, updates workpads, and keeps the dashboard visible.

When the user explicitly asks for goal-mode automation and the four startup answers are already provided or recorded, use the helper's `goal` command instead of manual `init` + `record-preflight` + `sync-linear` plumbing:

```bash
node plugins/linear-workflow-orchestrator/scripts/linear-workflow-orchestrator.mjs goal "Build a Codex plugin" --apply --poll --repo-url https://github.com/OWNER/REPO.git --base-branch main --max-concurrent-agents 10 --max-turns 20
```

This command creates `WORKFLOW.md`, records startup answers, resolves or creates the Linear project from `LINEAR_API_KEY`, registers backlog issues, promotes dependency-ready work to Todo, and optionally runs one Linear poll tick. After bootstrap, instruct the user to run the terminal TUI:

```bash
~/.codex/bin/linear-workflow-orchestrator-tui
```

Do not replace the TUI with repeated Codex-side `set-status ... --apply-linear` calls. In goal mode those calls are only for explicit review/merge interventions, not routine progress.

1. Restate the development goal and authority assumptions.
2. Create or update `workflow.md` at the repository root by running the helper `goal` or `init` command. Do not hand-write or manually patch the Symphony-style front matter unless repairing a helper bug; the helper owns `tracker`, `workspace`, `hooks`, `agent`, `github`, and `codex` metadata.
3. Record startup answers before creating Linear issues or starting work:

```bash
node plugins/linear-workflow-orchestrator/scripts/linear-workflow-orchestrator.mjs record-preflight workflow.md --workspace github --credentials exported --goal-mode off --max-concurrent-agents 10 --max-turns 20
```

4. Include:
   - Symphony-style front matter:
     - `tracker.kind: linear`
     - `workspace.root`
     - `hooks.after_create`
     - `agent.max_concurrent_agents`
     - `agent.max_turns`
     - `github.repo_url`
     - `github.base_branch`
     - `codex.command`
   - goal mode value
   - agent limits from startup answers
   - GitHub/Linear authority checklist
   - credential sources without secret values
   - status model
   - execution table with issue IDs, titles, lane type, dependencies, status, Linear issue, Branch/Worktree, and acceptance criteria
   - goal-mode continuation gate
5. In goal mode, if Linear writes are authorized and credentials exist, run the single bootstrap command `goal ... --apply --poll`. If Codex asks for network approval for that one bootstrap call, request it once. If approval is denied or the user wants zero Codex-side network prompts, stop and give the exact terminal command for the user to run outside Codex. Do not fall back to manual status-by-status mutation.

For non-goal/manual mode only, if Linear writes are authorized and credentials exist, run:

```bash
node plugins/linear-workflow-orchestrator/scripts/linear-workflow-orchestrator.mjs sync-linear workflow.md --apply
```

6. If Linear writes are not authorized or credentials are missing, run a dry-run instead:

```bash
node plugins/linear-workflow-orchestrator/scripts/linear-workflow-orchestrator.mjs sync-linear workflow.md --dry-run-out linear-issues.preview.json
```

After a dry-run or failed Linear apply, do not continue as though Linear orchestration is complete. The final response for that turn must explicitly hand off the next Linear action and ask whether to run Linear registration now. Use this Korean shape:

```text
workflow.md와 linear-issues.preview.json까지 준비했습니다. 이 상태는 아직 Linear backlog 등록 전입니다.

Linear API 정보를 현재 세션에 export하거나 env 파일 경로를 주면, 다음 단계로 실제 Linear issue 등록을 실행할까요?
```

If the user already supplied credentials in the conversation but they are not visible in the shell, say that the current Codex shell cannot see them and ask whether to use direct env values or an env file for the next `sync-linear --apply` step. Do not mark Linear-backed issues Done or present the workflow as fully complete while `Linear Issue` cells are empty.

7. After Linear backlog registration, do not implement directly on `main`.
8. Treat Linear as the execution queue, not a passive mirror:
   - Backlog issues are not implemented.
   - Todo means queued and ready; the terminal TUI/poller moves selected issues to In Progress before implementation.
   - In Progress/Rework/Review/Merging issues must have exactly one active Linear comment containing `## Codex Workpad`.
   - The `## Codex Workpad` comment is the source of truth for plan, checklist, progress log, validation evidence, PR link, blockers, review findings, and handoff notes.
   - Update the same workpad comment throughout the run; do not scatter separate progress comments.
   - Do not mark a Linear-backed issue Done unless its workpad records completed acceptance criteria, validation evidence, and merge/PR outcome.
   - In goal mode, do not ask the user whether to move routine implementation issues to Done; the execution/review/merge policy controls state transitions.
9. Use the issue dependency graph:
   - run `ready` to identify Backlog/Todo issues whose dependencies are Done
   - run `wave` to identify dependency-ready parallel issues that can be assigned together
   - move only the selected ready issue or ready parallel wave into execution
   - for serial lanes, start one issue at a time
   - for parallel lanes, start all dependency-satisfied parallel siblings together when the user wants Symphony-style concurrent Codex work
10. Manual mode only: select work before starting it:

```bash
node plugins/linear-workflow-orchestrator/scripts/linear-workflow-orchestrator.mjs select-issue workflow.md LWO-004
```

11. Manual mode only: for each started issue, run `start-issue` to record the branch/worktree, move it to In Progress, and create or update the Linear workpad when `--apply-linear` is used:

```bash
node plugins/linear-workflow-orchestrator/scripts/linear-workflow-orchestrator.mjs start-issue workflow.md LWO-004 --mode github --checkout --apply-linear
node plugins/linear-workflow-orchestrator/scripts/linear-workflow-orchestrator.mjs start-issue workflow.md LWO-004 --mode worktree --worktree-dir ../project-HOW-76 --checkout --apply-linear
```

12. For Symphony-style concurrent work:
   - prefer the unattended poller for goal mode execution:
     - `tui WORKFLOW.md` shows the dashboard and runs the Linear poller loop in one terminal
     - `run WORKFLOW.md` is an alias for the same terminal operator loop
     - `poll WORKFLOW.md` runs one dispatch tick
     - `daemon WORKFLOW.md` keeps polling Linear on `polling.interval_ms`
   - the poller reads Linear issues from `tracker.project_slug`; the local `workflow.md` table is not the source of execution truth in this mode
   - the poller claims `Todo` issues by moving them to `In Progress`, creates/reuses `workspace.root/<issue-id>`, updates the Linear `## Codex Workpad`, and executes `codex.command` inside that workspace
   - read `agent.max_concurrent_agents` from `workflow.md` before dispatch
   - dispatch up to `agent.max_concurrent_agents` lanes concurrently
   - assign each ready parallel issue to a separate Codex session/subagent/worktree, but never exceed `agent.max_concurrent_agents`
   - pass `agent.max_turns` to the lane command through `SYMPHONY_MAX_TURNS` and `LWO_MAX_TURNS`; if the lane reaches it before completion, update the workpad with a blocker/handoff rather than silently continuing
   - set `codex.command: codex app-server` when the user wants the lane runner to be `codex app-server`
   - each Codex lane owns exactly one Linear issue and its branch/worktree
   - each lane updates only its own Linear `## Codex Workpad`
   - no lane may edit another lane's owned files unless the orchestrator updates the workflow
   - merge only after all parallel lane reviews pass
13. Move implemented work to Review and use a different Codex agent/session as reviewer.
14. Move review failures to Rework and keep the issue branch/worktree active until fixed.
15. Move accepted work to Merging only after review passes; if a Codex-side Linear status update is needed here, it must be tied to an explicit review verdict, not a generic "should I mark Done?" prompt.
16. Merge using the issue branch/PR or local worktree integration branch, never by committing unrelated completed work directly to `main`.
17. Mark obsolete work as Canceled or Duplicate.
18. Before claiming completion, audit all workflow acceptance criteria, Linear issue statuses, and the issue workpad.
19. In goal mode, create a follow-up workflow when the current audit finds remaining product work.

## Helper CLI

The helper script can initialize a deterministic workflow template and parse/sync existing `workflow.md` files:

```bash
node plugins/linear-workflow-orchestrator/scripts/linear-workflow-orchestrator.mjs goal "Build a Codex plugin" --apply --poll --repo-url https://github.com/OWNER/REPO.git --base-branch main --max-concurrent-agents 10 --max-turns 20
node plugins/linear-workflow-orchestrator/scripts/linear-workflow-orchestrator.mjs init "Build a Codex plugin" --goal-mode on --out workflow.md
node plugins/linear-workflow-orchestrator/scripts/linear-workflow-orchestrator.mjs init "Build a Codex plugin" --goal-mode on --max-concurrent-agents 10 --max-turns 20 --repo-url https://github.com/OWNER/REPO.git --base-branch main --out workflow.md
node plugins/linear-workflow-orchestrator/scripts/linear-workflow-orchestrator.mjs preflight
node plugins/linear-workflow-orchestrator/scripts/linear-workflow-orchestrator.mjs record-preflight workflow.md --workspace github --credentials exported --goal-mode on --max-concurrent-agents 10 --max-turns 20
node plugins/linear-workflow-orchestrator/scripts/linear-workflow-orchestrator.mjs resolve-linear workflow.md
node plugins/linear-workflow-orchestrator/scripts/linear-workflow-orchestrator.mjs parse workflow.md
node plugins/linear-workflow-orchestrator/scripts/linear-workflow-orchestrator.mjs sync-linear workflow.md --dry-run-out linear-issues.preview.json
node plugins/linear-workflow-orchestrator/scripts/linear-workflow-orchestrator.mjs ready workflow.md
node plugins/linear-workflow-orchestrator/scripts/linear-workflow-orchestrator.mjs wave workflow.md
node plugins/linear-workflow-orchestrator/scripts/linear-workflow-orchestrator.mjs dashboard workflow.md
node plugins/linear-workflow-orchestrator/scripts/linear-workflow-orchestrator.mjs dashboard WORKFLOW.md --watch
node plugins/linear-workflow-orchestrator/scripts/linear-workflow-orchestrator.mjs run WORKFLOW.md
node plugins/linear-workflow-orchestrator/scripts/linear-workflow-orchestrator.mjs tui WORKFLOW.md
node plugins/linear-workflow-orchestrator/scripts/linear-workflow-orchestrator.mjs poll WORKFLOW.md
node plugins/linear-workflow-orchestrator/scripts/linear-workflow-orchestrator.mjs daemon WORKFLOW.md
node plugins/linear-workflow-orchestrator/scripts/linear-workflow-orchestrator.mjs select-issue workflow.md LWO-004
node plugins/linear-workflow-orchestrator/scripts/linear-workflow-orchestrator.mjs start-issue workflow.md LWO-004 --mode github --checkout --apply-linear
node plugins/linear-workflow-orchestrator/scripts/linear-workflow-orchestrator.mjs start-issue workflow.md LWO-004 --mode worktree --worktree-dir ../project-HOW-76 --checkout --apply-linear
node plugins/linear-workflow-orchestrator/scripts/linear-workflow-orchestrator.mjs workpad workflow.md LWO-004 --note "Implemented add/list/remove command parsing and storage."
node plugins/linear-workflow-orchestrator/scripts/linear-workflow-orchestrator.mjs set-status workflow.md LWO-004 Review
node plugins/linear-workflow-orchestrator/scripts/linear-workflow-orchestrator.mjs set-status workflow.md LWO-004 Merging --reviewed-by codex-reviewer
LINEAR_API_KEY=... LINEAR_TEAM_ID=... node plugins/linear-workflow-orchestrator/scripts/linear-workflow-orchestrator.mjs set-status workflow.md LWO-004 Review --linear-issue ABC-123 --apply-linear
node plugins/linear-workflow-orchestrator/scripts/linear-workflow-orchestrator.mjs statusline workflow.md
node plugins/linear-workflow-orchestrator/scripts/linear-workflow-orchestrator.mjs statusline workflow.md --hyperlink --linear-base-url https://linear.app/choijhyeok
```

The agent should still refine the execution table with domain-specific tasks before creating Linear issues, but it must preserve helper-owned front matter. Active implementation must be selected with `select-issue` before `start-issue`. Once an issue reaches In Progress, update the Linear `## Codex Workpad` before and after meaningful implementation, validation, review, and merge steps.

## Terminal Status Line

To emit the current Linear stage and task title for a host status line, use the helper's status-line output:

```bash
node plugins/linear-workflow-orchestrator/scripts/linear-workflow-orchestrator.mjs statusline workflow.md
```

Example:

```text
Linear In Progress: LWO-004 Execute independent implementation lanes · ABC-123
```

The command reads `workflow.md` and chooses the most active issue in this priority order: In Progress, Rework, Review, Merging, Todo, Backlog. Plugin installation exposes this command, while actual native TUI status-line registration remains owned by the host Codex/OMX setup. Current Codex TUI builds do not run arbitrary plugin dashboard commands below the composer, so use the installed dashboard wrapper with `--watch`, or the installed runner wrapper, in a terminal split or OMX HUD pane until the host exposes command-backed HUD panels.

Use `--hyperlink` with `--linear-base-url` or `LINEAR_PROJECT_URL` when the host status line preserves OSC 8 terminal hyperlinks. This lets the visible Linear issue identifier open the corresponding Linear issue page.

## Linear API Notes

Linear uses a GraphQL endpoint at `https://api.linear.app/graphql`. Personal API keys are sent as `Authorization: <API_KEY>`; OAuth access tokens use `Authorization: Bearer <ACCESS_TOKEN>`. `issueCreate` requires `teamId` and `title`; if no `stateId` is provided, Linear assigns the team's first Backlog/Triage state. This skill attempts to find a team state named `Backlog` and uses it when available.
