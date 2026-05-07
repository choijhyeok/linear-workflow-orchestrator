#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const DEFAULT_INTERVAL_MS = 5000;
const DEFAULT_MAX_RETRY_BACKOFF_MS = 300000;
const ACTIVE_STATUSES = new Set(["todo", "in progress", "rework", "review", "merging"]);
const TERMINAL_STATUSES = new Set(["done", "canceled", "cancelled", "duplicate"]);
const MUTED = {
  bg: "#111315",
  panel: "#171a1d",
  border: "#3d434a",
  text: "#c8ccd1",
  dim: "#8a929b",
  accent: "#7ea1b8",
  accentSoft: "#668396",
  ok: "#7d9a7d",
  warn: "#b0a06b",
  error: "#aa7474",
};

function parseArgs(argv) {
  const options = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      options._.push(arg);
      continue;
    }
    const key = arg.slice(2);
    if (["help", "no-poll", "debug", "foreground-agent", "stream-agent-output", "dry-run-agent", "skip-hooks"].includes(key)) {
      options[key] = true;
      continue;
    }
    options[key] = argv[index + 1];
    index += 1;
  }
  return options;
}

function printHelp() {
  process.stdout.write([
    "Usage: linear-workflow-orchestrator-tui <WORKFLOW.md> [--interval-ms 5000] [--no-poll] [--debug]",
    "",
    "Controls:",
    "  q / Ctrl-C   exit",
    "  r            refresh now",
    "",
    "Options:",
    "  --debug      show compact poll diagnostics in the TUI summary",
    "",
  ].join("\n"));
}

function parseEnvFileLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (!match) return null;
  let value = match[2].trim();
  if (
    (value.startsWith("\"") && value.endsWith("\"")) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return [match[1], value];
}

function loadEnvFile(filePath) {
  if (!filePath) return;
  const resolved = path.resolve(filePath);
  for (const line of fs.readFileSync(resolved, "utf8").split(/\r?\n/)) {
    const parsed = parseEnvFileLine(line);
    if (parsed) process.env[parsed[0]] = parsed[1];
  }
}

function cells(line) {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}

function coerceScalar(value) {
  const trimmed = String(value).trim();
  const unquoted = (
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) ? trimmed.slice(1, -1) : trimmed;
  const numeric = Number(unquoted);
  return Number.isFinite(numeric) && unquoted !== "" ? numeric : unquoted;
}

function parseWorkflowConfigFallback(markdown) {
  const config = {
    tracker: { kind: "linear", project_slug: "", active_states: ["Todo", "In Progress", "Merging", "Rework"] },
    polling: { interval_ms: 30000 },
    workspace: { root: "~/code/workspaces" },
    hooks: {},
    agent: { max_concurrent_agents: 3, max_turns: 20, max_retry_backoff_ms: DEFAULT_MAX_RETRY_BACKOFF_MS },
    github: { repo_url: "", base_branch: "main" },
    codex: { command: "" },
  };
  if (!markdown.startsWith("---\n")) return config;
  const end = markdown.indexOf("\n---", 4);
  if (end === -1) return config;
  const lines = markdown.slice(4, end).split(/\r?\n/);
  let section = "";
  let pendingListKey = "";
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const sectionMatch = line.match(/^([A-Za-z_][A-Za-z0-9_-]*):\s*$/);
    if (sectionMatch) {
      section = sectionMatch[1];
      pendingListKey = "";
      if (!config[section]) config[section] = {};
      continue;
    }
    const listItemMatch = line.match(/^\s+-\s*(.*)$/);
    if (listItemMatch && section && pendingListKey && Array.isArray(config[section][pendingListKey])) {
      config[section][pendingListKey].push(coerceScalar(listItemMatch[1]));
      continue;
    }
    const valueMatch = line.match(/^\s+([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/);
    if (!valueMatch || !section) continue;
    const [, key, rawValue] = valueMatch;
    if (rawValue.trim() === "|") {
      const block = [];
      while (lines[index + 1]?.match(/^\s{4,}/)) {
        index += 1;
        block.push(lines[index].replace(/^\s{4}/, ""));
      }
      config[section][key] = block.join("\n").trimEnd();
      pendingListKey = "";
      continue;
    }
    if (rawValue.trim() === "") {
      config[section][key] = [];
      pendingListKey = key;
      continue;
    }
    config[section][key] = coerceScalar(rawValue);
    pendingListKey = "";
  }
  return config;
}

function parseWorkflowFallback(markdown) {
  const issues = [];
  let inPlan = false;
  for (const line of markdown.split(/\r?\n/)) {
    if (line.trim() === "## Execution Plan") {
      inPlan = true;
      continue;
    }
    if (inPlan && line.startsWith("## ")) break;
    if (!inPlan || !line.trim().startsWith("|")) continue;
    const row = cells(line);
    if (![7, 8].includes(row.length) || row[0] === "ID" || row[0] === "---") continue;
    const hasBranchColumn = row.length === 8;
    issues.push({
      key: row[0],
      title: row[1],
      lane: row[2],
      dependsOn: row[3].split(",").map((dep) => dep.trim()).filter((dep) => dep && dep !== "-"),
      status: row[4],
      linearIssue: row[5] === "-" ? "" : row[5],
      branch: hasBranchColumn && row[6] !== "-" ? row[6] : "",
      acceptance: hasBranchColumn ? row[7] : row[6],
    });
  }
  return issues;
}

function workflowTitle(markdown, workflowPath) {
  return markdown.match(/^# Workflow:\s*(.+)$/m)?.[1]?.trim() || path.basename(workflowPath);
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function runStateDir(workflowDir) {
  return path.join(workflowDir, ".lwo", "runs");
}

function readRunStates(workflowDir) {
  const dir = runStateDir(workflowDir);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => readJsonFile(path.join(dir, name)))
    .filter(Boolean);
}

function readAgentLogs(workflowDir) {
  const dir = path.join(workflowDir, ".lwo", "agent-logs");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((name) => name.endsWith(".log"))
    .map((name) => {
      const logPath = path.join(dir, name);
      const stats = fs.statSync(logPath);
      return { name, path: logPath, mtimeMs: stats.mtimeMs, size: stats.size };
    })
    .sort((left, right) => right.mtimeMs - left.mtimeMs);
}

function readLastNonEmptyLine(filePath) {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    const lines = content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    return lines.at(-1) ?? "";
  } catch {
    return "";
  }
}

function short(text, width) {
  const value = String(text ?? "");
  if (value.length <= width) return value;
  if (width <= 1) return value.slice(0, width);
  return `${value.slice(0, width - 1)}…`;
}

function pad(text, width) {
  return short(text, width).padEnd(width, " ");
}

function relativeTime(value, now = Date.now()) {
  const stamp = new Date(value).getTime();
  if (!Number.isFinite(stamp)) return "-";
  const diff = Math.max(0, now - stamp);
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function activeIssueCount(issues) {
  return issues.filter((issue) => ACTIVE_STATUSES.has(String(issue.status).toLowerCase())).length;
}

function statusCounts(issues) {
  const counts = new Map();
  for (const issue of issues) {
    counts.set(issue.status, (counts.get(issue.status) ?? 0) + 1);
  }
  return counts;
}

function depsSatisfied(issue, doneKeys) {
  return issue.dependsOn.every((dep) => doneKeys.has(dep));
}

function buildSnapshot(workflowPath, helper) {
  const resolvedWorkflow = path.resolve(workflowPath);
  const workflowDir = path.dirname(resolvedWorkflow);
  const markdown = fs.readFileSync(resolvedWorkflow, "utf8");
  const parseWorkflow = helper?.parseWorkflow ?? parseWorkflowFallback;
  const parseWorkflowConfig = helper?.parseWorkflowConfig ?? parseWorkflowConfigFallback;
  const issues = parseWorkflow(markdown);
  const config = parseWorkflowConfig(markdown);
  const runStates = readRunStates(workflowDir);
  const logFiles = readAgentLogs(workflowDir);
  const runsByIssue = new Map();
  for (const state of runStates) {
    const keys = [state.id, state.issue, state.key].filter(Boolean);
    for (const key of keys) {
      if (!runsByIssue.has(key)) runsByIssue.set(key, state);
    }
  }
  const latestLog = logFiles[0] ?? null;
  return {
    workflowPath: resolvedWorkflow,
    workflowDir,
    title: workflowTitle(markdown, resolvedWorkflow),
    markdown,
    issues,
    config,
    runStates,
    runsByIssue,
    logFiles,
    latestLog,
  };
}

function computeHeader(snapshot, intervalMs, now = Date.now()) {
  const { issues, config, runStates, logFiles, latestLog } = snapshot;
  const counts = statusCounts(issues);
  const maxAgents = Number(config.agent?.max_concurrent_agents ?? issues.length ?? 0);
  const runningStates = runStates.filter((state) => String(state.status).toLowerCase() === "running").length;
  const completedStates = runStates.filter((state) => String(state.status).toLowerCase() === "completed").length;
  const failedStates = runStates.filter((state) => ["failed", "unknown"].includes(String(state.status).toLowerCase())).length;
  const doneKeys = new Set(issues.filter((issue) => TERMINAL_STATUSES.has(String(issue.status).toLowerCase())).map((issue) => issue.key));
  const ready = issues.filter((issue) => ["backlog", "todo"].includes(String(issue.status).toLowerCase()) && depsSatisfied(issue, doneKeys)).length;
  return {
    metrics: [
      { label: "Active", value: `${activeIssueCount(issues)}/${maxAgents}` },
      { label: "Ready", value: String(ready) },
      { label: "Done", value: String(counts.get("Done") ?? counts.get("done") ?? 0) },
      { label: "Runs", value: `${runningStates} live / ${completedStates} done / ${failedStates} stalled` },
      { label: "Logs", value: String(logFiles.length) },
      { label: "Refresh", value: `${Math.max(1, Math.round(intervalMs / 1000))}s` },
    ],
    summary: [
      `Project ${snapshot.title}`,
      `Tracker ${config.tracker?.project_slug || "pending"}`,
      `Workflow ${path.basename(snapshot.workflowPath)}`,
      `Updated ${new Date(now).toLocaleTimeString()}`,
      latestLog ? `Latest log ${latestLog.name} (${relativeTime(latestLog.mtimeMs, now)})` : "Latest log -",
    ].join("  ·  "),
  };
}

function buildRunningRows(snapshot, now = Date.now()) {
  const rows = [["Issue", "Status", "Linear", "PID", "Age", "Lane", "Event"]];
  const active = snapshot.issues
    .filter((issue) => ACTIVE_STATUSES.has(String(issue.status).toLowerCase()))
    .sort((left, right) => left.key.localeCompare(right.key));

  if (!active.length) {
    rows.push(["-", "Idle", "-", "-", "-", "-", "No active workflow rows"]);
    return rows;
  }

  for (const issue of active) {
    const state = snapshot.runsByIssue.get(issue.key) ?? snapshot.runsByIssue.get(issue.linearIssue);
    const logLine = state?.logPath ? readLastNonEmptyLine(state.logPath) : "";
    rows.push([
      issue.key,
      issue.status,
      issue.linearIssue || "-",
      String(state?.pid ?? "-"),
      relativeTime(state?.updatedAt ?? state?.startedAt, now),
      issue.lane || "-",
      short(state?.event || logLine || issue.title, 84),
    ]);
  }
  return rows;
}

function nextBackoffAt(state, maxRetryBackoffMs) {
  const updatedAt = new Date(state?.updatedAt ?? state?.startedAt ?? 0).getTime();
  if (!Number.isFinite(updatedAt) || !updatedAt) return "-";
  return new Date(updatedAt + maxRetryBackoffMs).toLocaleTimeString();
}

function buildBackoffRows(snapshot) {
  const rows = [["Issue", "Reason", "Depends On", "Next"]];
  const maxBackoff = Number(snapshot.config.agent?.max_retry_backoff_ms ?? DEFAULT_MAX_RETRY_BACKOFF_MS);
  const doneKeys = new Set(
    snapshot.issues
      .filter((issue) => TERMINAL_STATUSES.has(String(issue.status).toLowerCase()))
      .map((issue) => issue.key)
  );
  const stalled = new Set();

  for (const issue of snapshot.issues) {
    const state = snapshot.runsByIssue.get(issue.key) ?? snapshot.runsByIssue.get(issue.linearIssue);
    const lowerStatus = String(issue.status).toLowerCase();
    if (["backlog", "todo"].includes(lowerStatus) && !depsSatisfied(issue, doneKeys)) {
      rows.push([issue.key, "blocked by dependencies", issue.dependsOn.join(", "), "wait"]);
      stalled.add(issue.key);
      continue;
    }
    if (state && ["failed", "unknown"].includes(String(state.status).toLowerCase())) {
      rows.push([
        issue.key,
        short(state.event || state.status, 44),
        issue.dependsOn.join(", ") || "-",
        nextBackoffAt(state, maxBackoff),
      ]);
      stalled.add(issue.key);
    }
  }

  if (rows.length === 1) rows.push(["-", "No blocked or stalled work", "-", "-"]);
  return rows;
}

async function loadBlessed() {
  try {
    return require("blessed");
  } catch (error) {
    throw new Error(`blessed is required to run the TUI: ${error.message}`);
  }
}

async function loadHelper() {
  const helperPath = new URL("./linear-workflow-orchestrator.mjs", import.meta.url);
  try {
    const helper = await import(helperPath);
    if (typeof helper.parseWorkflow === "function" && typeof helper.parseWorkflowConfig === "function") return helper;
  } catch {
    return null;
  }
  return null;
}

function renderMetricBox(metrics) {
  return metrics.map((metric) => `{bold}${metric.label}{/bold}\n${metric.value}`).join("\n\n");
}

function createApp(blessed, workflowPath, intervalMs, helper, options = {}) {
  const screen = blessed.screen({
    smartCSR: true,
    fullUnicode: true,
    dockBorders: true,
    useBCE: true,
    title: "Linear Workflow Orchestrator",
  });
  screen.program.alternateBuffer();
  screen.program.hideCursor();

  const header = blessed.box({
    parent: screen,
    top: 0,
    left: 0,
    width: "100%",
    height: 7,
    tags: true,
    padding: { left: 1, right: 1, top: 0, bottom: 0 },
    style: { fg: MUTED.text, bg: MUTED.bg },
  });

  const metrics = blessed.box({
    parent: header,
    top: 0,
    left: 0,
    width: "22%",
    height: "100%",
    tags: true,
    content: "",
    style: { fg: MUTED.text, bg: MUTED.bg },
  });

  const summary = blessed.box({
    parent: header,
    top: 0,
    left: "23%",
    width: "77%",
    height: "100%",
    tags: true,
    valign: "middle",
    style: { fg: MUTED.dim, bg: MUTED.bg },
  });

  const running = blessed.listtable({
    parent: screen,
    top: 7,
    left: 0,
    width: "100%",
    height: "62%",
    keys: false,
    mouse: false,
    tags: false,
    align: "left",
    border: { type: "line" },
    style: {
      fg: MUTED.text,
      bg: MUTED.panel,
      border: { fg: MUTED.border },
      header: { fg: MUTED.accent, bg: MUTED.panel, bold: true },
      cell: { fg: MUTED.text, bg: MUTED.panel },
    },
    label: " Running ",
    pad: 1,
  });

  const backoff = blessed.listtable({
    parent: screen,
    bottom: 1,
    left: 0,
    width: "100%",
    height: "31%",
    keys: false,
    mouse: false,
    tags: false,
    align: "left",
    border: { type: "line" },
    style: {
      fg: MUTED.text,
      bg: MUTED.panel,
      border: { fg: MUTED.border },
      header: { fg: MUTED.warn, bg: MUTED.panel, bold: true },
      cell: { fg: MUTED.text, bg: MUTED.panel },
    },
    label: " Backoff Queue ",
    pad: 1,
  });

  const footer = blessed.box({
    parent: screen,
    bottom: 0,
    left: 0,
    width: "100%",
    height: 1,
    tags: true,
    style: { fg: MUTED.dim, bg: MUTED.bg },
    content: "  q / Ctrl-C exit   r refresh   muted live view from WORKFLOW.md, .lwo/runs, .lwo/agent-logs",
  });

  let timer = null;
  let rendering = false;
  let lastError = "";
  let lastPoll = null;

  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void refresh(), intervalMs);
  };

  const shutdown = () => {
    if (timer) clearTimeout(timer);
    screen.program.showCursor();
    screen.program.normalBuffer();
    screen.destroy();
  };

  const refresh = async () => {
    if (rendering) return;
    rendering = true;
    try {
      if (!options["no-poll"] && helper?.pollLinearOnce && process.env.LINEAR_API_KEY) {
        try {
          lastPoll = await helper.pollLinearOnce(workflowPath, {
            ...options,
            "background-agent": !options["foreground-agent"],
          });
        } catch (error) {
          lastError = `poll: ${error.message || String(error)}`;
        }
      }
      const snapshot = buildSnapshot(workflowPath, helper);
      const headerData = computeHeader(snapshot, intervalMs);
      metrics.setContent(renderMetricBox(headerData.metrics));
      summary.setContent([
        `{bold}${snapshot.title}{/bold}`,
        headerData.summary,
        lastPoll ? `Poll candidates ${lastPoll.candidates} · dispatched ${lastPoll.dispatched}` : "",
        options.debug && lastPoll ? JSON.stringify(lastPoll) : "",
        lastError ? `{red-fg}${lastError}{/red-fg}` : "",
      ].filter(Boolean).join("\n"));
      running.setData(buildRunningRows(snapshot));
      backoff.setData(buildBackoffRows(snapshot));
      footer.setContent(`  q / Ctrl-C exit   r refresh   ${path.relative(process.cwd(), snapshot.workflowPath) || path.basename(snapshot.workflowPath)}`);
      lastError = "";
    } catch (error) {
      lastError = short(error.message || String(error), 180);
      summary.setContent(`{bold}${path.basename(workflowPath)}{/bold}\n{red-fg}${lastError}{/red-fg}`);
      running.setData([["Issue", "Status", "Linear", "PID", "Age", "Lane", "Event"], ["-", "error", "-", "-", "-", "-", lastError]]);
      backoff.setData([["Issue", "Reason", "Depends On", "Next"], ["-", "refresh failed", "-", "-"]]);
    } finally {
      rendering = false;
      screen.render();
      schedule();
    }
  };

  screen.key(["q", "C-c"], () => {
    shutdown();
    process.exit(0);
  });
  screen.key(["r"], () => {
    void refresh();
  });
  screen.on("resize", () => {
    screen.render();
  });

  return { refresh, shutdown };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options["env-file"]) loadEnvFile(options["env-file"]);
  if (options.help) {
    printHelp();
    return;
  }

  const workflowPath = options._[0];
  if (!workflowPath) {
    printHelp();
    process.exitCode = 1;
    return;
  }
  const resolvedWorkflow = path.resolve(workflowPath);
  if (!fs.existsSync(resolvedWorkflow)) {
    throw new Error(`workflow file not found: ${resolvedWorkflow}`);
  }

  const intervalMs = Math.max(
    1000,
    Number(options["interval-ms"] ?? process.env.LWO_TUI_INTERVAL_MS ?? DEFAULT_INTERVAL_MS) || DEFAULT_INTERVAL_MS
  );
  const [blessed, helper] = await Promise.all([loadBlessed(), loadHelper()]);
  const app = createApp(blessed, resolvedWorkflow, intervalMs, helper, options);

  process.on("SIGTERM", () => {
    app.shutdown();
    process.exit(0);
  });

  await app.refresh();
}

main().catch((error) => {
  process.stderr.write(`${error.message || String(error)}\n`);
  process.exit(1);
});
