# Linear Workflow Orchestrator

Codex plugin prototype for turning a development goal into a `workflow.md`, creating Linear issues, and guiding Codex through status-driven implementation.

The intended workflow is not "create Linear issues after the work is already done." It is:

1. Ask startup questions for GitHub branch vs local worktree, Linear credential source, goal mode, agent limits, and Linear issue workflow states before inspecting or editing the target project.
2. Register all discovered tasks as Linear Backlog issues.
3. Move only dependency-ready issues into Todo/In Progress.
4. Create or reuse one Linear `## Codex Workpad` comment per active issue and record plan, progress, validation, PR links, review findings, and handoff notes there.
5. Create one issue branch or local worktree per active Linear issue.
6. Run serial work one issue at a time; run ready `parallel` lanes in separate Codex sessions/worktrees for Symphony-style concurrent execution.
7. Move implemented work to Review and use a different Codex session/agent for code review.
8. Merge only reviewed issue branches/PRs or local worktree integration branches.

## Command Shape

```text
$linear-workflow-orchestrator <development goal> [goal mode: on|off]
```

Use the `$` skill invocation form in Codex. `/linear-workflow-orchestrator` is not a native Codex slash command and will be rejected before the skill can run.

The plugin skill asks for GitHub authority, Linear authority, and Linear credentials before external writes. If Linear credentials are not available, it produces a dry-run JSON payload instead of calling Linear.

## Default Statuses

Backlog, Todo, In Progress, Rework, Review, Merging, Done, Canceled, and Duplicate are built into every workflow. For Linear issue workflow states, the helper defaults to Backlog, Todo, In Progress, Review, Merging, Canceled, and Duplicate; pass `--linear-statuses` or answer the fifth startup question to customize the team states used by project issues.

## Local CLI

```bash
node plugins/linear-workflow-orchestrator/scripts/linear-workflow-orchestrator.mjs goal "Build my feature" --apply --open-tui --repo-url https://github.com/OWNER/REPO.git --base-branch main
node plugins/linear-workflow-orchestrator/scripts/linear-workflow-orchestrator.mjs init "Build my feature" --goal-mode on --out workflow.md
node plugins/linear-workflow-orchestrator/scripts/linear-workflow-orchestrator.mjs init "Build my feature" --goal-mode on --max-concurrent-agents 10 --max-turns 20 --out workflow.md
node plugins/linear-workflow-orchestrator/scripts/linear-workflow-orchestrator.mjs preflight
node plugins/linear-workflow-orchestrator/scripts/linear-workflow-orchestrator.mjs record-preflight workflow.md --workspace github --credentials exported --goal-mode on --max-concurrent-agents 10 --max-turns 20 --linear-statuses "Backlog, Todo, In Progress, Review, Merging, Canceled, Duplicate"
node plugins/linear-workflow-orchestrator/scripts/linear-workflow-orchestrator.mjs parse workflow.md
LINEAR_TEAM_ID=team-id node plugins/linear-workflow-orchestrator/scripts/linear-workflow-orchestrator.mjs sync-linear workflow.md --dry-run-out linear-issues.preview.json
LINEAR_API_KEY=... LINEAR_TEAM_ID=... node plugins/linear-workflow-orchestrator/scripts/linear-workflow-orchestrator.mjs sync-linear workflow.md --apply
node plugins/linear-workflow-orchestrator/scripts/linear-workflow-orchestrator.mjs ready workflow.md
node plugins/linear-workflow-orchestrator/scripts/linear-workflow-orchestrator.mjs wave workflow.md
node plugins/linear-workflow-orchestrator/scripts/linear-workflow-orchestrator.mjs select-issue workflow.md LWO-004
node plugins/linear-workflow-orchestrator/scripts/linear-workflow-orchestrator.mjs start-issue workflow.md LWO-004 --mode github --checkout
node plugins/linear-workflow-orchestrator/scripts/linear-workflow-orchestrator.mjs start-issue workflow.md LWO-004 --mode worktree --worktree-dir ../project-HOW-76 --checkout
node plugins/linear-workflow-orchestrator/scripts/linear-workflow-orchestrator.mjs set-status workflow.md LWO-004 "In Progress"
node plugins/linear-workflow-orchestrator/scripts/linear-workflow-orchestrator.mjs set-status workflow.md LWO-004 Merging --reviewed-by codex-reviewer
LINEAR_API_KEY=... LINEAR_TEAM_ID=... node plugins/linear-workflow-orchestrator/scripts/linear-workflow-orchestrator.mjs set-status workflow.md LWO-004 Review --linear-issue ABC-123 --apply-linear
node plugins/linear-workflow-orchestrator/scripts/linear-workflow-orchestrator.mjs statusline workflow.md
node plugins/linear-workflow-orchestrator/scripts/linear-workflow-orchestrator.mjs statusline workflow.md --hyperlink --linear-base-url https://linear.app/choijhyeok
node plugins/linear-workflow-orchestrator/scripts/linear-workflow-orchestrator.mjs dashboard workflow.md
node plugins/linear-workflow-orchestrator/scripts/linear-workflow-orchestrator.mjs dashboard WORKFLOW.md --watch
node plugins/linear-workflow-orchestrator/scripts/linear-workflow-orchestrator.mjs run WORKFLOW.md
node plugins/linear-workflow-orchestrator/scripts/linear-workflow-orchestrator.mjs tui WORKFLOW.md
node plugins/linear-workflow-orchestrator/scripts/linear-workflow-orchestrator.mjs open-tui WORKFLOW.md
node plugins/linear-workflow-orchestrator/scripts/linear-workflow-orchestrator.mjs poll WORKFLOW.md
node plugins/linear-workflow-orchestrator/scripts/linear-workflow-orchestrator.mjs daemon WORKFLOW.md
```

`goal` is the friendlier Symphony-style bootstrap path. It writes `WORKFLOW.md`, records goal-mode startup answers, creates or resolves the Linear project from `LINEAR_API_KEY`, registers backlog issues, promotes dependency-ready work to Todo, and can open the terminal operator with `--open-tui`. Use `daemon WORKFLOW.md` after bootstrap for a continuous Linear-driven loop.

`--apply` calls Linear's GraphQL API. Without `--apply`, the script only generates the payload that would be sent.

Generated workflows include Symphony-style front matter for `tracker`, `workspace`, `hooks`, `agent`, `github`, and `codex`. When `--repo-url` is supplied, the generated `after_create` hook clones the repository and checks out the per-issue branch from `SYMPHONY_ISSUE_BRANCH`. `agent.max_concurrent_agents` limits how many ready parallel issues `wave` selects, and `agent.max_turns` is surfaced as the per-issue lane budget in the dashboard/workflow policy.

In goal mode, the skill bypasses routine continuation prompts after startup authority is recorded. With `LINEAR_API_KEY` alone, `sync-linear --apply` can resolve the first visible Linear team and create a workflow project when no `LINEAR_PROJECT_URL` is provided.

For unattended Symphony-style operation, use `tui WORKFLOW.md` for one combined terminal TUI + polling operator screen, `open-tui WORKFLOW.md` to launch that screen in a new terminal, `poll` for one dispatch tick, or `daemon` for a continuous polling loop. These commands read Linear candidate issues from `tracker.project_slug`, claim eligible `Todo` work by moving it to `In Progress`, create/reuse the issue workspace under `workspace.root`, run configured hooks, update the Linear `## Codex Workpad`, and execute `codex.command` inside that per-issue workspace. The poller dispatches up to `agent.max_concurrent_agents` issues concurrently and passes `agent.max_turns` through the agent environment as `SYMPHONY_MAX_TURNS`/`LWO_MAX_TURNS`. The generated default `codex.command` is `codex app-server`; the poller starts a local app-server control plane under `.lwo/app-server.json` and drives issue turns through it. Set an explicit `codex exec ...` command only when you want the older standalone exec runner.

## Status Line And Dashboard

The plugin includes a Node.js status-line emitter for hosts that support command-backed status items:

```bash
node plugins/linear-workflow-orchestrator/scripts/linear-workflow-orchestrator.mjs statusline workflow.md
```

Example output:

```text
Linear In Progress: LWO-004 Execute independent implementation lanes · ABC-123
```

It selects the first issue by active status priority: In Progress, Rework, Review, Merging, Todo, then Backlog.

For a larger Symphony-style terminal TUI in a new terminal, side pane, or terminal split, use:

```bash
~/.codex/bin/linear-workflow-orchestrator-tui
```

This wrapper first looks for `plugins/linear-workflow-orchestrator/scripts/linear-workflow-orchestrator-tui.mjs`. When that companion TUI script exists, the installed command delegates to it directly; otherwise it falls back to `node plugins/linear-workflow-orchestrator/scripts/linear-workflow-orchestrator.mjs tui WORKFLOW.md`. Use `~/.codex/bin/linear-workflow-orchestrator-dashboard --watch` when you only want the auto-refreshing dashboard without polling, or `~/.codex/bin/linear-workflow-orchestrator-run` as the older alias for the same combined operator loop.

For an Elixir-like terminal TUI workflow:

```bash
~/.codex/bin/linear-workflow-orchestrator-tui WORKFLOW.md
~/.codex/bin/linear-workflow-orchestrator-tui --debug
~/.codex/bin/linear-workflow-orchestrator-tui --foreground-agent --stream-agent-output
```

The installed wrapper uses `WORKFLOW.md` by default when no workflow path is provided, including flag-only invocations such as `--debug`. `--debug` adds compact poll diagnostics to the TUI summary so you can inspect poll ticks and lane starts without flooding the full-screen redraw. `--foreground-agent --stream-agent-output` swaps the default quiet background lane execution for raw agent stdout/stderr in the same terminal, which is useful for troubleshooting but will interrupt the clean full-screen redraw. Regardless of mode, lane output is persisted under each issue workspace's `.lwo/agent-logs/` directory so the operator can review full raw logs after the screen refresh has moved on.

When `goal --open-tui` or `open-tui` launches a new terminal, exported environment variables from the current shell may not be inherited by macOS Terminal. The helper writes only the required Linear variables to a private `0600` env file under `~/.codex/linear-workflow-orchestrator/env/` and passes that file path to the TUI; secret values are not printed in the launch command.

Current Codex TUI builds own the composer/status-line rendering and do not execute arbitrary plugin dashboard commands under the composer, so the plugin cannot force Symphony-style rows to appear below the prompt by itself. In a separate terminal, this is just a normal terminal TUI and does not depend on Codex TUI support.

For hosts that support command-backed status lines in the future:

```toml
statusLine = { type = "command", command = "/absolute/path/to/linear-workflow-orchestrator/plugins/linear-workflow-orchestrator/scripts/linear-workflow-orchestrator.mjs" }
```

## Plugin Layout

- `plugins/linear-workflow-orchestrator/.codex-plugin/plugin.json`
- `plugins/linear-workflow-orchestrator/skills/linear-workflow-orchestrator/SKILL.md`
- `plugins/linear-workflow-orchestrator/scripts/linear-workflow-orchestrator.mjs`
- `tests/linear-workflow-orchestrator.test.mjs`

## Installability

This repository includes a repo-local plugin marketplace at `.agents/plugins/marketplace.json`. The plugin itself has no Python dependency and no npm dependency install; the helper CLI is a single Node.js standard-library script.

Run verification with:

```bash
npm test
```

Install from GitHub for Codex testing:

```bash
codex plugin marketplace add https://github.com/choijhyeok/linear-workflow-orchestrator
npm install
npm run install:local
```

Install from a local checkout:

```bash
codex plugin marketplace add /Users/jaehyeokchoi/Desktop/linear-workflow-orchestrator
npm install
npm run install:local
```

`install:local` also installs `~/.codex/bin/linear-workflow-orchestrator-statusline`, `~/.codex/bin/linear-workflow-orchestrator-dashboard`, `~/.codex/bin/linear-workflow-orchestrator-run`, `~/.codex/bin/linear-workflow-orchestrator-tui`, and `~/.codex/bin/linear-workflow-orchestrator-open-tui`, then registers plugin metadata in Codex config. The installed TUI wrapper prefers the optional companion TUI script when present and otherwise falls back to the helper's built-in `tui` command. When the host supports command-backed status lines or HUD panels, active Linear workflow issues can be rendered from the current `workflow.md`; otherwise use the dashboard wrapper in a side pane or the TUI wrapper in a separate terminal.

## Dogfood Example

`examples/bookmark-cli` is a small real CLI used to dogfood this plugin's Linear-to-GitHub workflow. It supports:

```bash
node examples/bookmark-cli/bin/bookmark.js add "OpenAI" https://openai.com
node examples/bookmark-cli/bin/bookmark.js list
node examples/bookmark-cli/bin/bookmark.js remove https://openai.com/
```
