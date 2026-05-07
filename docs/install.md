# Installation

This repository is structured as a Codex plugin marketplace.

## GitHub Install

Register the GitHub-hosted marketplace:

```bash
codex plugin marketplace add https://github.com/choijhyeok/linear-workflow-orchestrator
```

Then install the plugin metadata and expose the skill directory to Codex exec sessions:

```bash
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
npm run install:local
```

This writes `~/.codex/config.json`.

It also installs:

```text
~/.codex/bin/linear-workflow-orchestrator-statusline
```

and registers that command in `~/.codex/config.toml`/`config.json` so command-backed Codex or OMX HUD hosts can show the active Linear issue automatically. The wrapper reads `workflow.md` from the current directory and uses `LINEAR_PROJECT_URL` or `LINEAR_WORKSPACE_URL` for clickable Linear issue links.

## Runtime

The plugin uses Node.js standard library only. There is no Python package, no npm dependency install, and no build step.

## Execution Model

At the start of a workflow, the skill should ask:

- whether to use GitHub issue branches or local worktrees
- whether Linear credentials are exported, stored in an env file, or supplied by the user
- whether goal mode is on

These questions are a hard startup gate. The skill should ask them before inspecting the target repository, creating `workflow.md`, or deciding that the project is local-only.

After Linear backlog registration, active work must start through `start-issue` so the workflow records an issue-specific branch or worktree:

```bash
node plugins/linear-workflow-orchestrator/scripts/linear-workflow-orchestrator.mjs ready workflow.md
node plugins/linear-workflow-orchestrator/scripts/linear-workflow-orchestrator.mjs wave workflow.md
node plugins/linear-workflow-orchestrator/scripts/linear-workflow-orchestrator.mjs select-issue workflow.md LWO-004
node plugins/linear-workflow-orchestrator/scripts/linear-workflow-orchestrator.mjs start-issue workflow.md LWO-004 --mode github --checkout
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
