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

## Runtime

The plugin uses Node.js standard library only. There is no Python package, no npm dependency install, and no build step.

## Verification

```bash
npm test
```

or directly:

```bash
node --test tests/*.test.mjs
```

## Status Line

Plugin installation exposes the status-line helper script, but native TUI status-line registration is still owned by the host Codex/OMX setup:

```bash
node plugins/linear-workflow-orchestrator/scripts/linear-workflow-orchestrator.mjs statusline workflow.md
```

See `docs/statusline.md`.

For command-backed status-line capable hosts, point the host config at the executable script path:

```toml
statusLine = { type = "command", command = "/absolute/path/to/linear-workflow-orchestrator/plugins/linear-workflow-orchestrator/scripts/linear-workflow-orchestrator.mjs" }
```
