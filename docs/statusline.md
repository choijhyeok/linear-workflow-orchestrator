# Status Line Integration

The plugin can emit a compact status string for the current `workflow.md` task:

```bash
node plugins/linear-workflow-orchestrator/scripts/linear-workflow-orchestrator.mjs statusline workflow.md
```

Example:

```text
Linear In Progress: LWO-004 Execute independent implementation lanes · ABC-123
```

For terminals or HUD renderers that preserve OSC 8 hyperlinks, enable clickable Linear issue identifiers:

```bash
LINEAR_PROJECT_URL=https://linear.app/choijhyeok/project/hanwha-project-5f527568b378/issues \
node plugins/linear-workflow-orchestrator/scripts/linear-workflow-orchestrator.mjs statusline workflow.md --hyperlink
```

You can also pass the workspace URL directly:

```bash
node plugins/linear-workflow-orchestrator/scripts/linear-workflow-orchestrator.mjs statusline workflow.md --hyperlink --linear-base-url https://linear.app/choijhyeok
```

This renders the issue identifier as a clickable terminal hyperlink when supported. If the host strips OSC 8 escape sequences, the status line still falls back to the normal visible issue identifier.

This is intentionally implemented as a Node.js script because Codex plugins are installed as plugin bundles, not Python packages. Node.js is already the runtime used by Codex/OMX hook tooling, and the script has no npm dependencies.

## Selection Rule

The status line chooses the first issue in this priority order:

1. In Progress
2. Rework
3. Review
4. Merging
5. Todo
6. Backlog

Done, Canceled, and Duplicate issues are terminal and do not occupy the active statusline slot.

## Host Wiring

Codex plugin installation discovers skills and plugin files. Native TUI status-line registration is host setup territory, so the plugin provides an executable command that a host status-line or OMX HUD integration can call.

For Codex builds that support a command-backed status line, configure the host to execute the plugin script:

```toml
statusLine = { type = "command", command = "/absolute/path/to/linear-workflow-orchestrator/plugins/linear-workflow-orchestrator/scripts/linear-workflow-orchestrator.mjs" }
```

For a Codex-HUD-style command, point the HUD item at:

```bash
node /absolute/path/to/linear-workflow-orchestrator/plugins/linear-workflow-orchestrator/scripts/linear-workflow-orchestrator.mjs statusline workflow.md --hyperlink --linear-base-url https://linear.app/choijhyeok
```

The script defaults to reading `workflow.md` from the current working directory, which lets the same installed plugin work across project checkouts.

If a future Codex plugin API supports command-backed status-line registration directly in `.codex-plugin/plugin.json`, this command should be wired there without changing the workflow file format.
