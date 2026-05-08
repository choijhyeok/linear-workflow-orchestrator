# Installation

This repository is structured as a Codex plugin marketplace.

## GitHub Install

Register the GitHub-hosted marketplace:

```bash
codex plugin marketplace add https://github.com/choijhyeok/linear-workflow-orchestrator
```

Then install the plugin metadata and expose the skill directory to Codex exec sessions:

```bash
npm install
npm run install:local
```

## Repo-Local Install

The marketplace entry lives at:

```text
.agents/plugins/marketplace.json
```

It points to:

```text
./plugins/linear-workflow-orchestrator
```

The plugin itself is defined by:

```text
plugins/linear-workflow-orchestrator/.codex-plugin/plugin.json
```

Register the local marketplace:

```bash
codex plugin marketplace add /Users/jaehyeokchoi/Desktop/linear-workflow-orchestrator
```

Then install the local plugin metadata and expose the skill directory to Codex exec sessions:
This also installs the skill into `~/.codex/skills/linear-workflow-orchestrator/SKILL.md` with absolute helper paths so it works from any project directory.

```bash
npm install
npm run install:local
```

This writes `~/.codex/config.json`.

It also installs:

```text
~/.codex/bin/linear-workflow-orchestrator-statusline
~/.codex/bin/linear-workflow-orchestrator-dashboard
~/.codex/bin/linear-workflow-orchestrator-run
~/.codex/bin/linear-workflow-orchestrator-tui
```

and registers plugin metadata in `~/.codex/config.toml`/`config.json` for command-backed Codex or OMX HUD hosts. The status-line wrapper reads `workflow.md` from the current directory and uses `LINEAR_PROJECT_URL` or `LINEAR_WORKSPACE_URL` for clickable Linear issue links.

Current Codex TUI builds do not execute arbitrary plugin HUD commands below the composer. If nothing appears under the prompt after install, that is a host limitation, not a failed plugin install. In a separate terminal this is just a normal terminal TUI: use `~/.codex/bin/linear-workflow-orchestrator-tui` for the combined dashboard + Linear poller loop, or `~/.codex/bin/linear-workflow-orchestrator-dashboard --watch` for an auto-refreshing dashboard without polling.

## Runtime

The plugin runtime is Node.js. Run `npm install` once in a fresh checkout so the companion terminal TUI dependency is available; there is no Python package and no build step.

## Execution Model

Invoke the workflow skill with `$linear-workflow-orchestrator <development goal>`. Do not use `/linear-workflow-orchestrator`; Codex reserves slash commands for built-in commands and rejects unknown slash commands before skills can run.

For goal-mode automation from a shell, use the `goal` helper:

```bash
LINEAR_API_KEY=... node plugins/linear-workflow-orchestrator/scripts/linear-workflow-orchestrator.mjs goal "Build bookmark CLI" --apply --poll --repo-url https://github.com/OWNER/REPO.git --base-branch main
```

This creates `WORKFLOW.md`, records goal mode, creates or resolves the Linear project, registers backlog issues, promotes ready work to Todo, and runs one Linear poll tick. Start `tui WORKFLOW.md` when you want the continuous dashboard + Linear-driven terminal TUI, or `daemon WORKFLOW.md` when you only want JSON polling output.

Generated `workflow.md` files include Symphony-style front matter:

```yaml
tracker:
  kind: linear
workspace:
  root: ~/code/workspaces
agent:
  max_concurrent_agents: 10
  max_turns: 20
codex:
  command: codex app-server
```

The helper owns this front matter. Do not manually recreate it; pass `--repo-url`, `--workspace-root`, `--base-branch`, `--codex-command`, `--max-concurrent-agents`, and `--max-turns` to the helper when those values need to change.

`wave` respects `agent.max_concurrent_agents` when selecting parallel work. `dashboard` shows the active/max agent count and turn budget. The TUI/poller dispatches at most `agent.max_concurrent_agents` active issue lanes and passes `agent.max_turns` to each Codex lane as its per-issue turn budget.

When goal mode is on, the skill should bypass routine "continue?" prompts after startup authority is recorded. It should keep progressing until the goal is complete, blocked by missing credentials, or blocked by out-of-scope/destructive action.

For Linear setup, `LINEAR_API_KEY` is enough for `sync-linear --apply` in the common case. If `LINEAR_TEAM_ID` is missing, the helper uses the first team visible to the API key. If `LINEAR_PROJECT_URL` is missing, the helper creates a Linear project for the workflow and uses that project id/url for issue registration. Before issue registration, the helper ensures the Linear team has the issue workflow states `Backlog, Todo, In Progress, Review, Merging, Canceled, Duplicate`; pass `--linear-statuses "Backlog, Ready, Building, Review, Done"` or answer the fifth startup question to customize them.

For Symphony-style unattended execution, run `tui WORKFLOW.md` for the combined dashboard + polling terminal TUI, `poll WORKFLOW.md` for one dispatch tick, or `daemon WORKFLOW.md` for a JSON continuous loop. The poller reads Linear issues from `tracker.project_slug`, moves eligible Todo issues to In Progress, prepares `workspace.root/<issue>`, runs configured hooks, updates the single `## Codex Workpad`, and executes `codex.command` in that issue workspace. It dispatches up to `agent.max_concurrent_agents` issues concurrently and exposes `agent.max_turns` to the lane command as `SYMPHONY_MAX_TURNS`/`LWO_MAX_TURNS`. Generated workflows default to `codex.command: codex app-server`; the poller starts a local app-server control plane, records it in `.lwo/app-server.json`, and drives issue turns through that server. Use an explicit `codex exec ...` command only for the older standalone exec runner. This is the mode to use when Linear should drive development instead of acting as a passive mirror.

At the start of a workflow, the skill should ask:

- whether to use GitHub issue branches or local worktrees
- whether Linear credentials are exported, stored in an env file, or supplied by the user
- whether goal mode is on
- what `max_concurrent_agents` and `max_turns` should be
- whether to use the default Linear issue workflow states or a custom comma-separated status list

These questions are a hard startup gate. The skill should ask them before inspecting the target repository, creating `workflow.md`, or deciding that the project is local-only.

If Linear registration falls back to `linear-issues.preview.json`, the workflow is still before Linear backlog registration. The agent should end that turn by asking whether to run real Linear issue creation once credentials are available, instead of presenting the workflow as complete.

After Linear registration, Linear is the execution queue. When an issue moves from Todo to In Progress, the helper creates or reuses a single Linear comment headed `## Codex Workpad`; all plans, progress notes, validation evidence, review findings, PR links, and handoffs should be appended there instead of scattered across separate comments.

After Linear backlog registration, active work must start through `start-issue` so the workflow records an issue-specific branch or worktree:

```bash
node plugins/linear-workflow-orchestrator/scripts/linear-workflow-orchestrator.mjs ready workflow.md
node plugins/linear-workflow-orchestrator/scripts/linear-workflow-orchestrator.mjs wave workflow.md
node plugins/linear-workflow-orchestrator/scripts/linear-workflow-orchestrator.mjs select-issue workflow.md LWO-004
node plugins/linear-workflow-orchestrator/scripts/linear-workflow-orchestrator.mjs start-issue workflow.md LWO-004 --mode github --checkout --apply-linear
node plugins/linear-workflow-orchestrator/scripts/linear-workflow-orchestrator.mjs workpad workflow.md LWO-004 --note "Validation passed and PR is linked."
```

For concurrent Codex/Symphony-style work, start multiple dependency-ready `parallel` issues into separate branches or worktrees and assign one Codex session to each lane.

## Verification

```bash
npm test
```

or directly:

```bash
node --test tests/*.test.mjs
```

## Status Line

Plugin installation exposes and registers the status-line helper script:

```bash
~/.codex/bin/linear-workflow-orchestrator-statusline
```

See `docs/statusline.md`.

For command-backed status-line capable hosts, point the host config at the executable script path:

```toml
statusLine = { type = "command", command = "/absolute/path/to/linear-workflow-orchestrator/plugins/linear-workflow-orchestrator/scripts/linear-workflow-orchestrator.mjs" }
```
