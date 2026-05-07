# Linear Workflow Orchestrator

Codex plugin prototype for turning a development goal into a `workflow.md`, creating Linear issues, and guiding Codex through status-driven implementation.

The intended workflow is not "create Linear issues after the work is already done." It is:

1. Ask startup questions for GitHub branch vs local worktree, Linear credential source, and goal mode before inspecting or editing the target project.
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

Backlog, Todo, In Progress, Rework, Review, Merging, Done, Canceled, and Duplicate are built into every workflow. Users can add extra statuses when needed.

## Local CLI

```bash
node plugins/linear-workflow-orchestrator/scripts/linear-workflow-orchestrator.mjs init "Build my feature" --goal-mode on --out workflow.md
node plugins/linear-workflow-orchestrator/scripts/linear-workflow-orchestrator.mjs init "Build my feature" --goal-mode on --max-concurrent-agents 10 --max-turns 20 --out workflow.md
node plugins/linear-workflow-orchestrator/scripts/linear-workflow-orchestrator.mjs preflight
node plugins/linear-workflow-orchestrator/scripts/linear-workflow-orchestrator.mjs record-preflight workflow.md --workspace github --credentials exported --goal-mode on
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
```

`--apply` calls Linear's GraphQL API. Without `--apply`, the script only generates the payload that would be sent.

Generated workflows include Symphony-style front matter for `tracker`, `workspace`, `hooks`, `agent`, and `codex`. `agent.max_concurrent_agents` limits how many ready parallel issues `wave` selects, and `agent.max_turns` is surfaced as the per-issue lane budget in the dashboard/workflow policy.

In goal mode, the skill bypasses routine continuation prompts after startup authority is recorded. With `LINEAR_API_KEY` alone, `sync-linear --apply` can resolve the first visible Linear team and create a workflow project when no `LINEAR_PROJECT_URL` is provided.

## Status Line

The plugin includes a Node.js status-line emitter so Codex or OMX can show the current Linear workflow task under the terminal composer:

```bash
node plugins/linear-workflow-orchestrator/scripts/linear-workflow-orchestrator.mjs statusline workflow.md
```

Example output:

```text
Linear In Progress: LWO-004 Execute independent implementation lanes · ABC-123
```

It selects the first issue by active status priority: In Progress, Rework, Review, Merging, Todo, then Backlog.

For a larger Symphony-style operator view, use:

```bash
~/.codex/bin/linear-workflow-orchestrator-dashboard
```

This prints a multiline dashboard from `workflow.md`. Showing it under the Codex composer depends on the local Codex/OMX host supporting command-backed multiline HUD panels.

Codex plugins expose skills and companion files, but native TUI status-line wiring is owned by the local Codex/OMX setup. After installing the plugin, add this script as a custom status-line/HUD command in the host setup that supports command-backed status items.

For hosts that support command-backed status lines:

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
npm run install:local
```

Install from a local checkout:

```bash
codex plugin marketplace add /Users/jaehyeokchoi/Desktop/linear-workflow-orchestrator
npm run install:local
```

`install:local` also installs `~/.codex/bin/linear-workflow-orchestrator-statusline` and `~/.codex/bin/linear-workflow-orchestrator-dashboard`, then registers them in Codex config as plugin status commands. When the host supports command-backed status lines or HUD panels, active Linear workflow issues are shown automatically from the current `workflow.md`.

## Dogfood Example

`examples/bookmark-cli` is a small real CLI used to dogfood this plugin's Linear-to-GitHub workflow. It supports:

```bash
node examples/bookmark-cli/bin/bookmark.js add "OpenAI" https://openai.com
node examples/bookmark-cli/bin/bookmark.js list
node examples/bookmark-cli/bin/bookmark.js remove https://openai.com/
```
