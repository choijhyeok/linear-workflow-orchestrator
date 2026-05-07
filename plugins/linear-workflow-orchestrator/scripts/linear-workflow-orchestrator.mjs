#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";

export const DEFAULT_STATUSES = [
  ["Backlog", "All discovered work before it is selected for execution."],
  ["Todo", "Ready work, including parallel and serial lanes, waiting to start."],
  ["In Progress", "Work actively being implemented."],
  ["Rework", "Follow-up implementation requested after review or failed verification."],
  ["Review", "Review agent checks the developed code and workflow result."],
  ["Merging", "GitHub or local worktree integration and merge readiness."],
  ["Done", "Work is implemented, verified, and no longer active."],
  ["Canceled", "Work explicitly canceled or made obsolete by scope changes."],
  ["Duplicate", "Work excluded because another issue already covers it."],
];

export const LINEAR_ENDPOINT = "https://api.linear.app/graphql";
export const ACTIVE_STATUS_PRIORITY = [
  "In Progress",
  "Rework",
  "Review",
  "Merging",
  "Todo",
  "Backlog",
];
const ACTIVE_EXECUTION_STATUSES = new Set(["todo", "in progress", "rework", "review", "merging"]);
const TERMINAL_STATUSES = new Set(["done", "canceled", "duplicate"]);
export const WORKPAD_HEADER = "## Codex Workpad";

export function parseBool(value) {
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  throw new Error(`expected on/off or true/false, got ${value}`);
}

function slugTitle(goal) {
  const cleaned = goal.trim().replace(/\s+/g, " ");
  return cleaned.slice(0, 90) || "Development workflow";
}

function cells(line) {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}

function formatIssueRow(issue) {
  const deps = issue.dependsOn.length ? issue.dependsOn.join(", ") : "-";
  const linearIssue = issue.linearIssue || "-";
  const branch = issue.branch || "-";
  return `| ${issue.key} | ${issue.title} | ${issue.lane} | ${deps} | ${issue.status} | ${linearIssue} | ${branch} | ${issue.acceptance} |`;
}

function sentenceList(values) {
  return values.filter(Boolean).join("; ");
}

function inferredFeatureIssues(goal) {
  const normalized = goal.toLowerCase();
  if (/(bookmark|북마크)/.test(normalized)) {
    return [
      {
        key: "LWO-001",
        title: "Scaffold bookmark CLI package and storage",
        lane: "serial",
        dependsOn: [],
        acceptance: sentenceList([
          "package metadata and executable CLI entrypoint exist",
          "bookmark data is persisted in a JSON store under a user-writable path",
          "test isolation can override the data path",
        ]),
      },
      {
        key: "LWO-002",
        title: "Implement add command",
        lane: "parallel",
        dependsOn: ["LWO-001"],
        acceptance: sentenceList([
          "`add` stores a bookmark with title and URL",
          "invalid or duplicate input returns a clear non-zero failure",
          "command behavior is covered by tests",
        ]),
      },
      {
        key: "LWO-003",
        title: "Implement list command",
        lane: "parallel",
        dependsOn: ["LWO-001"],
        acceptance: sentenceList([
          "`list` prints stored bookmarks in deterministic order",
          "empty state is handled cleanly",
          "output is covered by tests",
        ]),
      },
      {
        key: "LWO-004",
        title: "Implement remove command",
        lane: "parallel",
        dependsOn: ["LWO-001"],
        acceptance: sentenceList([
          "`remove` deletes a bookmark by stable identifier or URL",
          "missing targets return a clear non-zero failure",
          "remove behavior is covered by tests",
        ]),
      },
      {
        key: "LWO-005",
        title: "Document and validate bookmark CLI",
        lane: "serial",
        dependsOn: ["LWO-002", "LWO-003", "LWO-004"],
        acceptance: sentenceList([
          "README shows add/list/remove usage",
          "automated tests pass",
          "manual smoke evidence is recorded",
        ]),
      },
    ];
  }

  return [
    {
      key: "LWO-001",
      title: `Define implementation contract for ${slugTitle(goal)}`,
      lane: "serial",
      dependsOn: [],
      acceptance: "scope, data flow, user-visible behavior, and validation plan are explicit before implementation starts",
    },
    {
      key: "LWO-002",
      title: `Implement core behavior for ${slugTitle(goal)}`,
      lane: "serial",
      dependsOn: ["LWO-001"],
      acceptance: "the requested user-facing behavior works end to end in the issue branch or worktree",
    },
    {
      key: "LWO-003",
      title: `Add validation coverage for ${slugTitle(goal)}`,
      lane: "parallel",
      dependsOn: ["LWO-001"],
      acceptance: "targeted automated tests or smoke checks cover the main success and failure paths",
    },
    {
      key: "LWO-004",
      title: `Review and prepare merge for ${slugTitle(goal)}`,
      lane: "serial",
      dependsOn: ["LWO-002", "LWO-003"],
      acceptance: "review findings are resolved, merge artifact is linked, and remaining risks are documented",
    },
  ];
}

export function buildWorkflow(goal, goalMode, extraStatuses = [], options = {}) {
  const maxConcurrentAgents = Number(options.maxConcurrentAgents ?? 3);
  const maxTurns = Number(options.maxTurns ?? 20);
  const workspaceRoot = options.workspaceRoot ?? "~/code/workspaces";
  const repoUrl = options.repoUrl ?? "";
  const baseBranch = options.baseBranch ?? "main";
  const codexCommand = options.codexCommand ?? "codex exec --dangerously-bypass-approvals-and-sandbox \"$SYMPHONY_ISSUE_PROMPT\"";
  const afterCreate = repoUrl
    ? [
      "    git clone \"$SYMPHONY_REPO_URL\" .",
      "    git fetch origin",
      "    git checkout -B \"$SYMPHONY_ISSUE_BRANCH\" \"origin/$SYMPHONY_BASE_BRANCH\"",
    ]
    : ["    # Optional: git clone git@github.com:your-org/your-repo.git ."];
  const statusRows = [
    ...DEFAULT_STATUSES,
    ...extraStatuses.map((status) => [status, "User-defined status."]),
  ];
  const issues = inferredFeatureIssues(goal).map((issue) => ({
    ...issue,
    status: "Backlog",
    linearIssue: "",
    branch: "",
  }));

  return [
    "---",
    "tracker:",
    "  kind: linear",
    "  project_slug: pending",
    "workspace:",
    `  root: ${workspaceRoot}`,
    "hooks:",
    "  after_create: |",
    ...afterCreate,
    "agent:",
    `  max_concurrent_agents: ${maxConcurrentAgents}`,
    `  max_turns: ${maxTurns}`,
    "github:",
    `  repo_url: ${repoUrl || "pending"}`,
    `  base_branch: ${baseBranch}`,
    "codex:",
    `  command: ${codexCommand}`,
    "---",
    "",
    `# Workflow: ${slugTitle(goal)}`,
    "",
    "## Goal",
    "",
    goal.trim(),
    "",
    "## Mode",
    "",
    `- Goal mode: ${goalMode ? "on" : "off"}`,
    "",
    "## Startup Answers",
    "",
    "- Execution workspace: pending",
    "- Linear credentials: pending",
    `- Goal mode: ${goalMode ? "on" : "off"}`,
    `- Max concurrent agents: ${maxConcurrentAgents}`,
    `- Max turns: ${maxTurns}`,
    "",
    "## Authority Checklist",
    "",
    "- [ ] Startup questions answered: GitHub branch flow or local worktree flow, Linear credential source, and goal mode.",
    "- [ ] GitHub authority confirmed for branches, worktrees, commits, PRs, and merge checks.",
    "- [ ] Linear authority confirmed for issue creation and status updates.",
    "- [ ] `LINEAR_API_KEY` source confirmed without exposing the secret.",
    "- [ ] `LINEAR_TEAM_ID` confirmed.",
    "- [ ] `LINEAR_PROJECT_URL` or project UUID confirmed when project attachment is required.",
    "",
    "## Status Model",
    "",
    "| Status | Meaning |",
    "| --- | --- |",
    ...statusRows.map(([name, meaning]) => `| ${name} | ${meaning} |`),
    "",
    "## Execution Plan",
    "",
    "| ID | Title | Lane | Depends On | Status | Linear Issue | Branch/Worktree | Acceptance Criteria |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...issues.map(formatIssueRow),
    "",
    "## Goal Mode Continuation Gate",
    "",
    "- [ ] Current workflow acceptance criteria are complete.",
    "- [ ] Review/rework loop has no open findings.",
    "- [ ] Merge readiness is verified.",
    "- [ ] If goal mode is on, Codex has checked whether another workflow slice is needed.",
    "",
  ].join("\n");
}

export function parseWorkflowConfig(markdown) {
  const config = {
    tracker: { kind: "linear", project_slug: "", active_states: ["Todo", "In Progress", "Merging", "Rework"], terminal_states: ["Closed", "Cancelled", "Canceled", "Duplicate", "Done"] },
    polling: { interval_ms: 30000 },
    workspace: { root: "~/code/workspaces" },
    hooks: {},
    agent: { max_concurrent_agents: 3, max_turns: 20, max_retry_backoff_ms: 300000 },
    github: { repo_url: "", base_branch: "main" },
    codex: { command: "codex exec --dangerously-bypass-approvals-and-sandbox \"$SYMPHONY_ISSUE_PROMPT\"" },
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

function coerceScalar(value) {
  const trimmed = String(value).trim();
  const unquoted = (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) ? trimmed.slice(1, -1) : trimmed;
  const numeric = Number(unquoted);
  return Number.isFinite(numeric) && unquoted !== "" ? numeric : unquoted;
}

export function workflowPromptTemplate(markdown) {
  if (!markdown.startsWith("---\n")) return markdown.trim();
  const end = markdown.indexOf("\n---", 4);
  return end === -1 ? markdown.trim() : markdown.slice(end + 4).trim();
}

export function parseWorkflow(markdown) {
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

export function currentIssue(issues) {
  for (const status of ACTIVE_STATUS_PRIORITY) {
    const match = issues.find((issue) => issue.status.toLowerCase() === status.toLowerCase());
    if (match) return match;
  }
  return issues.find((issue) => !TERMINAL_STATUSES.has(issue.status.toLowerCase())) ?? null;
}

export function formatStatusLine(issue, options = {}) {
  if (!issue) return options.empty ?? "Linear: no active workflow";
  const maxTitle = Number(options.maxTitle ?? 64);
  const title = issue.title.length > maxTitle ? `${issue.title.slice(0, Math.max(0, maxTitle - 1))}…` : issue.title;
  const url = linearIssueUrl(issue, options);
  const linearLabel = options.hyperlink && url ? terminalHyperlink(issue.linearIssue, url) : issue.linearIssue;
  const linear = issue.linearIssue ? ` · ${linearLabel}` : "";
  return `Linear ${issue.status}: ${issue.key} ${title}${linear}`;
}

function pad(value, width) {
  const text = String(value ?? "");
  return text.length > width ? `${text.slice(0, Math.max(0, width - 1))}…` : text.padEnd(width, " ");
}

export function formatDashboard(issues, options = {}) {
  const active = issues.filter((issue) => ACTIVE_EXECUTION_STATUSES.has(issue.status.toLowerCase()));
  const running = issues.filter((issue) => !TERMINAL_STATUSES.has(issue.status.toLowerCase()));
  const events = new Map((options.events ?? []).flatMap((event) => [
    [event.id, event],
    [event.issue, event],
    [event.key, event],
  ].filter((entry) => entry[0])));
  const maxAgents = Number(options.maxConcurrentAgents ?? issues.length);
  const maxTurns = Number(options.maxTurns ?? 20);
  const project = options.projectUrl ?? process.env.LINEAR_PROJECT_URL ?? "n/a";
  const nextRefresh = options.nextRefresh ?? "manual";
  const runtime = options.runtime ?? "n/a";
  const throughput = options.throughput ?? "n/a";
  const rows = [
    "┌ SYMPHONY STATUS",
    `Agents: ${active.length}/${maxAgents}`,
    `Throughput: ${throughput}`,
    `Runtime: ${runtime}`,
    "Tokens: in n/a | out n/a | total n/a",
    "Rate Limits: codex | primary n/a | secondary n/a | credits n/a",
    `Max turns: ${maxTurns}`,
    `Project: ${project}`,
    `Next refresh: ${nextRefresh}`,
    "├─ Running",
    "",
    `  ${pad("ID", 10)} ${pad("STAGE", 12)} ${pad("PID", 8)} ${pad("AGE / TURN", 12)} ${pad("TOKENS", 10)} ${pad("SESSION", 12)} EVENT`,
    `  ${"-".repeat(10)} ${"-".repeat(12)} ${"-".repeat(8)} ${"-".repeat(12)} ${"-".repeat(10)} ${"-".repeat(12)} ${"-".repeat(40)}`,
  ];
  for (const issue of running) {
    const id = issue.linearIssue || issue.key;
    const event = events.get(issue.linearIssue) ?? events.get(issue.key) ?? {};
    const branch = issue.branch ? ` · ${issue.branch}` : "";
    const message = event.event ?? `${issue.title}${branch}`;
    rows.push(`• ${pad(id, 10)} ${pad(issue.status, 12)} ${pad(event.pid || issue.pid || "-", 8)} ${pad(issue.turn ? `- / ${issue.turn}` : "- / -", 12)} ${pad(issue.tokens || "-", 10)} ${pad(issue.session || "-", 12)} ${message}`);
  }
  const blocked = issues.filter((issue) => issue.status.toLowerCase() === "backlog" && issue.dependsOn.length);
  rows.push("", "├─ Backoff queue", "");
  if (blocked.length) {
    for (const issue of blocked) rows.push(`  ${issue.key} waiting on ${issue.dependsOn.join(", ")}`);
  } else {
    rows.push("  No queued retries");
  }
  rows.push("└");
  return rows.join("\n");
}

export function linearWorkspaceBaseUrl(value) {
  if (!value) return "";
  const match = String(value).match(/^(https:\/\/linear\.app\/[^/]+)/);
  return match?.[1] ?? String(value).replace(/\/$/, "");
}

export function linearIssueUrl(issue, options = {}) {
  if (!issue?.linearIssue) return "";
  const baseUrl = linearWorkspaceBaseUrl(options.linearBaseUrl ?? options.projectUrl ?? process.env.LINEAR_WORKSPACE_URL ?? process.env.LINEAR_PROJECT_URL);
  if (!baseUrl) return "";
  return `${baseUrl}/issue/${encodeURIComponent(issue.linearIssue)}`;
}

export function terminalHyperlink(label, url) {
  return `\u001B]8;;${url}\u0007${label}\u001B]8;;\u0007`;
}

export function updateWorkflowStatus(markdown, issueKey, status, linearIssue = "") {
  let inPlan = false;
  let changed = false;
  const updated = markdown.split(/\r?\n/).map((line) => {
    if (line.trim() === "## Execution Plan") {
      inPlan = true;
      return line;
    }
    if (inPlan && line.startsWith("## ")) inPlan = false;
    if (inPlan && line.trim().startsWith("|")) {
      const row = cells(line);
      if ([7, 8].includes(row.length) && row[0] === issueKey) {
        row[4] = status;
        if (linearIssue) row[5] = linearIssue;
        changed = true;
        return `| ${row.join(" | ")} |`;
      }
    }
    return line;
  });
  if (!changed) throw new Error(`issue key ${issueKey} was not found in the Execution Plan table`);
  return updated.join("\n");
}

export function updateWorkflowBranch(markdown, issueKey, branchOrWorktree) {
  let inPlan = false;
  let changed = false;
  const updated = markdown.split(/\r?\n/).map((line) => {
    if (line.trim() === "## Execution Plan") {
      inPlan = true;
      return line;
    }
    if (inPlan && line.startsWith("## ")) inPlan = false;
    if (inPlan && line.trim().startsWith("|")) {
      const row = cells(line);
      if (row.length === 8 && row[0] === issueKey) {
        row[6] = branchOrWorktree;
        changed = true;
        return `| ${row.join(" | ")} |`;
      }
    }
    return line;
  });
  if (!changed) throw new Error(`issue key ${issueKey} was not found in the Execution Plan table with Branch/Worktree column`);
  return updated.join("\n");
}

export function updateWorkflowLinearIssues(markdown, createdIssuesByKey) {
  let inPlan = false;
  return markdown.split(/\r?\n/).map((line) => {
    if (line.trim() === "## Execution Plan") {
      inPlan = true;
      return line;
    }
    if (inPlan && line.startsWith("## ")) inPlan = false;
    if (inPlan && line.trim().startsWith("|")) {
      const row = cells(line);
      if ([7, 8].includes(row.length) && createdIssuesByKey.has(row[0])) {
        row[5] = createdIssuesByKey.get(row[0]);
        return `| ${row.join(" | ")} |`;
      }
    }
    return line;
  }).join("\n");
}

export function updateWorkflowTrackerProject(markdown, project) {
  if (!project?.slugId) return markdown;
  if (!markdown.startsWith("---\n")) return markdown;
  const end = markdown.indexOf("\n---", 4);
  if (end === -1) return markdown;
  const frontMatter = markdown.slice(0, end);
  const rest = markdown.slice(end);
  let inTracker = false;
  let changed = false;
  const updated = frontMatter.split(/\r?\n/).map((line) => {
    if (/^tracker:\s*$/.test(line)) {
      inTracker = true;
      return line;
    }
    if (/^[A-Za-z_][A-Za-z0-9_-]*:\s*$/.test(line) && !/^tracker:\s*$/.test(line)) inTracker = false;
    if (inTracker && /^\s+project_slug:\s*/.test(line)) {
      changed = true;
      return `  project_slug: "${project.slugId}"`;
    }
    return line;
  });
  if (!changed) {
    const trackerIndex = updated.findIndex((line) => /^tracker:\s*$/.test(line));
    if (trackerIndex !== -1) updated.splice(trackerIndex + 1, 0, `  project_slug: "${project.slugId}"`);
  }
  return `${updated.join("\n")}${rest}`;
}

export function updateWorkflowAgentConfig(markdown, options = {}) {
  if (!markdown.startsWith("---\n")) return markdown;
  const end = markdown.indexOf("\n---", 4);
  if (end === -1) return markdown;
  const frontMatter = markdown.slice(0, end);
  const rest = markdown.slice(end);
  let section = "";
  const updated = frontMatter.split(/\r?\n/).map((line) => {
    const sectionMatch = line.match(/^([A-Za-z_][A-Za-z0-9_-]*):\s*$/);
    if (sectionMatch) section = sectionMatch[1];
    if (section === "agent" && /^\s+max_concurrent_agents:\s*/.test(line) && options.maxConcurrentAgents) {
      return `  max_concurrent_agents: ${options.maxConcurrentAgents}`;
    }
    if (section === "agent" && /^\s+max_turns:\s*/.test(line) && options.maxTurns) {
      return `  max_turns: ${options.maxTurns}`;
    }
    return line;
  });
  return `${updated.join("\n")}${rest}`;
}

export function slugifyBranchPart(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "issue";
}

export function branchNameForIssue(issue) {
  const identifier = issue.linearIssue || issue.key;
  return `issue/${slugifyBranchPart(identifier)}-${slugifyBranchPart(issue.title)}`;
}

export function readyIssues(issues) {
  const done = new Set(issues.filter((issue) => issue.status.toLowerCase() === "done").map((issue) => issue.key));
  return issues.filter((issue) => {
    if (!["backlog", "todo"].includes(issue.status.toLowerCase())) return false;
    return issue.dependsOn.every((dependency) => done.has(dependency));
  });
}

export function parallelWave(issues, options = {}) {
  const maxConcurrentAgents = Number(options.maxConcurrentAgents ?? issues.length);
  const running = issues.filter((issue) => ACTIVE_EXECUTION_STATUSES.has(issue.status.toLowerCase())).length;
  const capacity = Math.max(0, maxConcurrentAgents - running);
  return readyIssues(issues).filter((issue) => issue.lane.toLowerCase() === "parallel").slice(0, capacity);
}

export function hasActiveSerialIssue(issues, issueKey) {
  return issues.some((issue) => {
    if (issue.key === issueKey) return false;
    if (issue.lane.toLowerCase() !== "serial") return false;
    return ACTIVE_EXECUTION_STATUSES.has(issue.status.toLowerCase());
  });
}

export function parseStartupAnswers(markdown) {
  const answers = {};
  let inSection = false;
  for (const line of markdown.split(/\r?\n/)) {
    if (line.trim() === "## Startup Answers") {
      inSection = true;
      continue;
    }
    if (inSection && line.startsWith("## ")) break;
    if (!inSection || !line.trim().startsWith("- ")) continue;
    const match = line.trim().match(/^- ([^:]+):\s*(.*)$/);
    if (match) answers[slugifyBranchPart(match[1]).replaceAll("-", "_")] = match[2].trim();
  }
  return answers;
}

export function startupAnswersComplete(markdown) {
  const answers = parseStartupAnswers(markdown);
  return ["execution_workspace", "linear_credentials", "goal_mode", "max_concurrent_agents", "max_turns"].every((key) => answers[key] && answers[key] !== "pending");
}

export function updateStartupAnswers(markdown, answers) {
  const rows = [
    `- Execution workspace: ${answers.workspace}`,
    `- Linear credentials: ${answers.credentials}`,
    `- Goal mode: ${answers.goalMode}`,
    `- Max concurrent agents: ${answers.maxConcurrentAgents ?? parseWorkflowConfig(markdown).agent.max_concurrent_agents}`,
    `- Max turns: ${answers.maxTurns ?? parseWorkflowConfig(markdown).agent.max_turns}`,
  ];
  if (!markdown.includes("## Startup Answers")) {
    return markdown.replace(/\n## Authority Checklist\n/, `\n## Startup Answers\n\n${rows.join("\n")}\n\n## Authority Checklist\n`);
  }
  let inSection = false;
  const updated = [];
  for (const line of markdown.split(/\r?\n/)) {
    if (line.trim() === "## Startup Answers") {
      inSection = true;
      updated.push(line, "", ...rows);
      continue;
    }
    if (inSection && line.startsWith("## ")) {
      inSection = false;
      updated.push("", line);
      continue;
    }
    if (!inSection) updated.push(line);
  }
  return updated.join("\n");
}

function requireStartupAnswers(markdown) {
  if (!startupAnswersComplete(markdown)) {
    throw new Error("Startup answers are required before this command. Run record-preflight first.");
  }
}

function requireLinearIssue(issue, options) {
  if (!issue.linearIssue && !options["local-only"]) {
    throw new Error(`issue ${issue.key} must have a Linear issue identifier before execution; use --local-only to bypass Linear-backed execution`);
  }
}

export function assertStatusTransition(issue, nextStatus, options = {}) {
  const current = issue.status.toLowerCase();
  const next = nextStatus.toLowerCase();
  const allowed = {
    backlog: new Set(["todo", "canceled", "duplicate"]),
    todo: new Set(["in progress", "canceled", "duplicate"]),
    "in progress": new Set(["review", "rework", "canceled"]),
    rework: new Set(["in progress", "review", "canceled"]),
    review: new Set(["rework", "merging", "canceled"]),
    merging: new Set(["done", "rework"]),
    done: new Set([]),
    canceled: new Set([]),
    duplicate: new Set([]),
  };
  if (current === next) return;
  if (!allowed[current]?.has(next)) throw new Error(`invalid status transition for ${issue.key}: ${issue.status} -> ${nextStatus}`);
  if (next === "merging" && !options["reviewed-by"]) throw new Error("--reviewed-by is required before moving Review to Merging");
}

function issueByKey(markdown, issueKey) {
  const issue = parseWorkflow(markdown).find((item) => item.key === issueKey);
  if (!issue) throw new Error(`issue key ${issueKey} was not found in the Execution Plan table`);
  return issue;
}

export function projectIdFromUrl(value) {
  if (!value) return null;
  return value.match(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/)?.[0] ?? null;
}

export function authorizationHeader(secret) {
  return secret;
}

export function linearDescription(issue, workflowPath) {
  const deps = issue.dependsOn.length ? issue.dependsOn.join(", ") : "None";
  const acceptanceItems = issue.acceptance.split(";").map((item) => item.trim()).filter(Boolean);
  return [
    `Generated by Linear Workflow Orchestrator from \`${workflowPath}\`. This issue is intended to be executed by the terminal TUI runner, not manually mirrored from Codex status prompts.`,
    "",
    "## Context",
    "",
    `This slice implements **${issue.title}** as part of the workflow plan. It should be worked in its own issue branch/worktree and recorded in the Codex Workpad below.`,
    "",
    "## Scope",
    "",
    `- Workflow ID: \`${issue.key}\``,
    `- Lane: \`${issue.lane}\``,
    `- Dependencies: ${deps}`,
    `- Initial queue status: \`${issue.status}\``,
    "- The terminal TUI should claim this issue only when dependencies are satisfied.",
    "- The implementation lane owns only this issue's branch/worktree and workpad.",
    "",
    "## Acceptance Criteria",
    "",
    ...acceptanceItems.map((item) => `- [ ] ${item}`),
    "",
    "## Validation",
    "",
    "- [ ] Automated tests or targeted smoke checks prove the acceptance criteria.",
    "- [ ] Evidence is recorded in the Codex Workpad before Review/Merging.",
    "- [ ] Review outcome and merge/PR link are recorded before Done.",
    "",
    "## Runner Notes",
    "",
    "- Queue ownership: terminal TUI / poller.",
    "- Routine progress should not be driven by repeated Codex-side `set-status --apply-linear` prompts.",
  ].join("\n");
}

export function initialWorkpadBody(issue, options = {}) {
  const now = options.now ?? new Date().toISOString();
  const branch = options.branch ? `\n- Branch/Worktree: \`${options.branch}\`` : "";
  const acceptanceItems = String(issue.acceptance ?? "").split(";").map((item) => item.trim()).filter(Boolean);
  return [
    WORKPAD_HEADER,
    "",
    "### Environment",
    "",
    `- Workflow ID: \`${issue.key}\``,
    `- Status: \`${issue.status}\`${branch}`,
    `- Last update: ${now}`,
    "",
    "### Acceptance Criteria",
    "",
    ...(acceptanceItems.length ? acceptanceItems.map((item) => `- [ ] ${item}`) : [`- [ ] ${issue.acceptance}`]),
    "",
    "### Plan",
    "",
    "- [ ] Confirm dependencies are satisfied before starting.",
    "- [ ] Inspect the relevant code paths and record the implementation approach.",
    "- [ ] Implement only this issue's scoped change in the issue branch/worktree.",
    "- [ ] Run validation and record evidence here.",
    "- [ ] Link PR or merge artifact before handoff.",
    "",
    "### Validation",
    "",
    "- [ ] Automated test or smoke command run recorded.",
    "- [ ] User-visible behavior evidence recorded when applicable.",
    "- [ ] Review/rework outcome recorded before merge.",
    "",
    "### Review / Merge",
    "",
    "- Reviewer: pending",
    "- Review outcome: pending",
    "- Merge/PR artifact: pending",
    "",
    "### Progress Log",
    "",
    `- ${now}: Workpad created.`,
    "",
  ].join("\n");
}

export function appendWorkpadNote(body, note, options = {}) {
  const now = options.now ?? new Date().toISOString();
  const entry = `- ${now}: ${note}`;
  if (body.includes("### Progress Log")) {
    return body.replace(/(### Progress Log\s*\n)/, `$1\n${entry}\n`);
  }
  return `${body.replace(/\n*$/, "\n\n")}### Progress Log\n\n${entry}\n`;
}

export function buildIssueInputs(issues, workflowPath, teamId, projectUrl, stateId = null, resolvedProjectId = null) {
  const projectId = resolvedProjectId ?? projectIdFromUrl(projectUrl);
  return issues.map((issue) => {
    const input = {
      teamId,
      title: `${issue.key}: ${issue.title}`,
      description: linearDescription(issue, workflowPath),
    };
    if (projectId) input.projectId = projectId;
    if (stateId) input.stateId = stateId;
    return input;
  });
}

async function graphql(apiKey, query, variables) {
  const response = await fetch(LINEAR_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: authorizationHeader(apiKey),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`Linear API HTTP ${response.status}: ${JSON.stringify(data)}`);
  if (data.errors) throw new Error(`Linear API returned errors: ${JSON.stringify(data.errors)}`);
  return data.data;
}

async function findStateId(apiKey, teamId, statusName) {
  const query = `
    query WorkflowStates($teamId: ID!) {
      workflowStates(filter: { team: { id: { eq: $teamId } } }) {
        nodes { id name }
      }
    }
  `;
  const data = await graphql(apiKey, query, { teamId });
  return data.workflowStates.nodes.find((state) => state.name.toLowerCase() === statusName.toLowerCase())?.id ?? null;
}

async function findProjectId(apiKey, teamId, projectUrl) {
  const explicitProjectId = projectIdFromUrl(projectUrl);
  if (explicitProjectId) return explicitProjectId;
  if (!projectUrl) return null;

  const normalizedProjectUrl = projectUrl.replace(/\/issues\/?$/, "").replace(/\/$/, "");
  const slugId = normalizedProjectUrl.match(/-([0-9a-fA-F]{12})(?:\/)?$/)?.[1] ?? "";
  const query = `
    query Projects($teamId: String!) {
      team(id: $teamId) {
        projects {
          nodes { id name slugId url }
        }
      }
    }
  `;
  const data = await graphql(apiKey, query, { teamId });
  const match = data.team.projects.nodes.find((project) => {
    const projectUrlValue = String(project.url ?? "").replace(/\/issues\/?$/, "").replace(/\/$/, "");
    return projectUrlValue === normalizedProjectUrl || project.slugId === slugId;
  });
  if (!match) throw new Error(`No Linear project matched ${projectUrl}. Check LINEAR_PROJECT_URL or provide a project UUID.`);
  return match.id;
}

async function firstLinearTeam(apiKey) {
  const query = `
    query Teams {
      teams {
        nodes { id name key }
      }
    }
  `;
  const data = await graphql(apiKey, query, {});
  return data.teams.nodes[0] ?? null;
}

function workflowTitle(markdown) {
  return markdown.match(/^# Workflow:\s*(.+)$/m)?.[1]?.trim() || "Codex workflow";
}

async function createLinearProject(apiKey, teamId, markdown, options = {}) {
  const name = options["project-name"] ?? workflowTitle(markdown);
  const mutation = `
    mutation ProjectCreate($input: ProjectCreateInput!) {
      projectCreate(input: $input) {
        success
        project { id name url slugId }
      }
    }
  `;
  const data = await graphql(apiKey, mutation, {
    input: {
      name,
      teamIds: [teamId],
      description: "Created by Linear Workflow Orchestrator.",
    },
  });
  if (!data.projectCreate.success) throw new Error(`Linear projectCreate did not succeed for ${name}`);
  return data.projectCreate.project;
}

async function resolveLinearContext(apiKey, workflowMarkdown, options = {}) {
  let teamId = options["team-id"] ?? process.env.LINEAR_TEAM_ID;
  let team = null;
  if (!teamId) {
    team = await firstLinearTeam(apiKey);
    if (!team) throw new Error("No Linear teams are visible to this API key.");
    teamId = team.id;
  }

  let projectUrl = options["project-url"] ?? process.env.LINEAR_PROJECT_URL;
  let projectId = projectIdFromUrl(projectUrl);
  let project = null;
  if (!projectId && projectUrl) {
    projectId = await findProjectId(apiKey, teamId, projectUrl);
  }
  if (!projectId && !projectUrl) {
    project = await createLinearProject(apiKey, teamId, workflowMarkdown, options);
    projectId = project.id;
    projectUrl = project.url;
  }

  return { teamId, team, projectId, projectUrl, project };
}

async function createLinearIssues(apiKey, issueInputs) {
  const mutation = `
    mutation IssueCreate($input: IssueCreateInput!) {
      issueCreate(input: $input) {
        success
        issue { id identifier title url state { name } }
      }
    }
  `;
  const created = [];
  for (const input of issueInputs) {
    const data = await graphql(apiKey, mutation, { input });
    if (!data.issueCreate.success) throw new Error(`Linear issueCreate did not succeed for ${input.title}`);
    created.push(data.issueCreate.issue);
  }
  return created;
}

async function updateLinearIssueStatus(apiKey, issueId, stateId) {
  const mutation = `
    mutation IssueUpdate($id: String!, $input: IssueUpdateInput!) {
      issueUpdate(id: $id, input: $input) {
        success
        issue { id identifier title url state { name } }
      }
    }
  `;
  const data = await graphql(apiKey, mutation, { id: issueId, input: { stateId } });
  if (!data.issueUpdate.success) throw new Error(`Linear issueUpdate did not succeed for ${issueId}`);
  return data.issueUpdate.issue;
}

function projectSlugFromUrl(value) {
  if (!value) return "";
  return String(value).replace(/\/issues\/?$/, "").replace(/\/$/, "").match(/-([0-9A-Za-z]{6,})(?:\/)?$/)?.[1] ?? "";
}

export function normalizeLinearIssue(issue) {
  return {
    id: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    description: issue.description ?? "",
    priority: issue.priority ?? null,
    state: issue.state?.name ?? issue.state ?? "",
    branchName: issue.branchName ?? null,
    url: issue.url ?? null,
    labels: issue.labels?.nodes?.map((label) => label.name?.toLowerCase()).filter(Boolean) ?? [],
    teamId: issue.team?.id ?? null,
    createdAt: issue.createdAt ?? null,
    updatedAt: issue.updatedAt ?? null,
  };
}

export async function fetchLinearCandidateIssues(apiKey, config, options = {}) {
  const projectSlug = config.tracker.project_slug && config.tracker.project_slug !== "pending"
    ? config.tracker.project_slug
    : projectSlugFromUrl(process.env.LINEAR_PROJECT_URL);
  if (!projectSlug) throw new Error("tracker.project_slug or LINEAR_PROJECT_URL is required for polling.");
  const activeStates = config.tracker.active_states ?? ["Todo", "In Progress"];
  const first = Number(options.first ?? Math.max(Number(config.agent?.max_concurrent_agents ?? 3) * 2, 10));
  const query = `
    query ProjectIssues($projectSlug: String!, $states: [String!], $first: Int!) {
      projects(filter: { slugId: { eq: $projectSlug } }) {
        nodes {
          id
          name
          slugId
          url
          issues(
            first: $first
            filter: { state: { name: { in: $states } } }
            orderBy: updatedAt
          ) {
            nodes {
              id
              identifier
              title
              description
              priority
              branchName
              url
              createdAt
              updatedAt
              state { name }
              team { id name key }
              labels { nodes { name } }
            }
          }
        }
      }
    }
  `;
  const data = await graphql(apiKey, query, { projectSlug, states: activeStates, first });
  const issues = data.projects.nodes.flatMap((project) => project.issues.nodes).map(normalizeLinearIssue);
  const active = new Set(activeStates.map((state) => state.toLowerCase()));
  return issues.filter((issue) => active.has(issue.state.toLowerCase())).sort(compareLinearIssues);
}

function compareLinearIssues(left, right) {
  const leftPriority = left.priority ?? 999;
  const rightPriority = right.priority ?? 999;
  if (leftPriority !== rightPriority) return leftPriority - rightPriority;
  const leftCreated = left.createdAt ?? "";
  const rightCreated = right.createdAt ?? "";
  if (leftCreated !== rightCreated) return leftCreated.localeCompare(rightCreated);
  return left.identifier.localeCompare(right.identifier);
}

export function workspaceKey(identifier) {
  return String(identifier).replace(/[^A-Za-z0-9._-]/g, "_");
}

function expandLocalPath(value, baseDir = process.cwd()) {
  let result = String(value || "");
  if (result.startsWith("~/")) result = path.join(os.homedir(), result.slice(2));
  result = result.replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (_match, name) => process.env[name] ?? "");
  return path.isAbsolute(result) ? result : path.resolve(baseDir, result);
}

export function workspacePathForIssue(config, issue, baseDir = process.cwd()) {
  return path.join(expandLocalPath(config.workspace.root, baseDir), workspaceKey(issue.identifier));
}

function issueRuntimeEnv(config, issue, extraEnv = {}) {
  const branchName = branchNameForIssue({
    key: issue.identifier,
    linearIssue: issue.identifier,
    title: issue.title,
  });
  const baseBranch = config.github?.base_branch && config.github.base_branch !== "pending"
    ? config.github.base_branch
    : "main";
  const repoUrl = config.github?.repo_url && config.github.repo_url !== "pending"
    ? config.github.repo_url
    : "";
  return {
    ...process.env,
    ...extraEnv,
    SYMPHONY_ISSUE_ID: issue.id ?? "",
    SYMPHONY_ISSUE_IDENTIFIER: issue.identifier ?? "",
    SYMPHONY_ISSUE_BRANCH: branchName,
    SYMPHONY_BASE_BRANCH: baseBranch,
    SYMPHONY_REPO_URL: repoUrl,
    LWO_ISSUE_BRANCH: branchName,
    LWO_BASE_BRANCH: baseBranch,
    LWO_REPO_URL: repoUrl,
  };
}

export function renderIssuePrompt(template, issue, attempt = null) {
  let rendered = template || "You are working on Linear issue {{ issue.identifier }}.";
  rendered = rendered.replace(/{%\s*if\s+attempt\s*%}([\s\S]*?){%\s*endif\s*%}/g, attempt ? "$1" : "");
  rendered = rendered.replaceAll("{{ attempt }}", String(attempt ?? ""));
  rendered = rendered.replace(/{{\s*issue\.([A-Za-z_][A-Za-z0-9_]*)\s*}}/g, (_match, key) => {
    const value = issue[key];
    return Array.isArray(value) ? value.join(", ") : String(value ?? "");
  });
  return rendered;
}

export function issueScopedPrompt(workflowMarkdown, issue, attempt = null) {
  const body = workflowPromptTemplate(workflowMarkdown);
  if (body.includes("{{ issue.")) {
    return renderIssuePrompt(body, issue, attempt);
  }
  const retryNote = attempt ? `\nRetry attempt: ${attempt}\n` : "";
  const description = String(issue.description || "").trim();
  return [
    `You are working on exactly one Linear issue: ${issue.identifier} - ${issue.title}.`,
    "",
    "Scope contract:",
    `- Implement only this issue: ${issue.identifier}.`,
    "- Do not implement sibling Linear issues, later workflow steps, documentation slices, review slices, or merge slices unless this issue explicitly asks for them.",
    "- If the repository contains WORKFLOW.md or other generated orchestration files, treat them as context only; they are not permission to complete the whole workflow.",
    "- Keep changes inside this issue branch/workspace.",
    "- Run the smallest meaningful validation for this issue and report evidence in the final response.",
    retryNote.trimEnd(),
    "Linear issue description:",
    description || "(No description provided.)",
  ].filter((part) => part !== "").join("\n");
}

export function prepareWorkspace(config, issue, options = {}) {
  const workflowDir = options.workflowDir ?? process.cwd();
  const workspacePath = workspacePathForIssue(config, issue, workflowDir);
  const createdNow = !fs.existsSync(workspacePath);
  fs.mkdirSync(workspacePath, { recursive: true });
  if (createdNow && config.hooks.after_create && !options.skipHooks) {
    execFileSync("sh", ["-lc", config.hooks.after_create], {
      cwd: workspacePath,
      stdio: options.streamHookOutput ? "inherit" : "ignore",
      env: issueRuntimeEnv(config, issue, options.env),
    });
  }
  return { path: workspacePath, createdNow };
}

function runHook(script, cwd, env) {
  if (!script) return null;
  execFileSync("sh", ["-lc", script], { cwd, stdio: "ignore", env });
  return { ok: true };
}

function runStateDir(workflowDir) {
  return path.join(workflowDir, ".lwo", "runs");
}

function runStatePath(workflowDir, identifier) {
  return path.join(runStateDir(workflowDir), `${slugifyBranchPart(identifier)}.json`);
}

function writeRunState(workflowDir, identifier, state) {
  const dir = runStateDir(workflowDir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(runStatePath(workflowDir, identifier), `${JSON.stringify({
    id: identifier,
    issue: identifier,
    updatedAt: new Date().toISOString(),
    ...state,
  }, null, 2)}\n`);
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function isPidRunning(pid) {
  if (!pid) return false;
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch {
    return false;
  }
}

function existingRunState(workflowDir, identifier) {
  const state = readJsonFile(runStatePath(workflowDir, identifier));
  if (!state) return null;
  if (state.status === "running" && !isPidRunning(state.pid)) {
    const updated = { ...state, status: "unknown", event: `process ended: ${state.event ?? "no exit captured"}` };
    writeRunState(workflowDir, identifier, updated);
    return updated;
  }
  return state;
}

function readRunEventsForWorkflow(workflowPath) {
  const dir = runStateDir(path.dirname(path.resolve(workflowPath)));
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => readJsonFile(path.join(dir, name)))
    .filter(Boolean);
}

async function runAgentCommand(command, cwd, prompt, env, options = {}) {
  if (options.dryRunAgent) return { skipped: true, command };
  return await new Promise((resolve, reject) => {
    const logDir = options.logDir ?? path.join(cwd, ".lwo", "agent-logs");
    fs.mkdirSync(logDir, { recursive: true });
    const logPath = path.join(logDir, `${slugifyBranchPart(options.issueIdentifier ?? "agent")}-${Date.now()}.log`);
    const log = fs.createWriteStream(logPath, { flags: "a" });
    let lastLine = "";
    const record = (chunk, target) => {
      const text = chunk.toString();
      log.write(text);
      const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      if (lines.length) lastLine = lines.at(-1);
      if (options.streamAgentOutput) target.write(text);
    };
    const child = spawn("sh", ["-lc", command], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...env,
        SYMPHONY_ISSUE_PROMPT: prompt,
        LWO_ISSUE_PROMPT: prompt,
        SYMPHONY_MAX_TURNS: String(options.maxTurns ?? ""),
        LWO_MAX_TURNS: String(options.maxTurns ?? ""),
      },
    });
    const started = {
      status: "running",
      command,
      pid: child.pid,
      logPath,
      event: "agent running",
      startedAt: new Date().toISOString(),
    };
    if (options.workflowDir && options.issueIdentifier) {
      writeRunState(options.workflowDir, options.issueIdentifier, started);
    }
    child.stdout.on("data", (chunk) => record(chunk, process.stdout));
    child.stderr.on("data", (chunk) => record(chunk, process.stderr));
    child.on("error", (error) => {
      log.end();
      if (options.workflowDir && options.issueIdentifier) {
        writeRunState(options.workflowDir, options.issueIdentifier, {
          ...started,
          status: "failed",
          event: `failed to start: ${error.message}`,
        });
      }
      reject(error);
    });
    child.on("close", (code, signal) => {
      log.end();
      if (code === 0) {
        const completed = {
          ok: true,
          status: "completed",
          command,
          pid: child.pid,
          logPath,
          event: lastLine ? `completed: ${lastLine}` : `completed: log ${path.relative(cwd, logPath)}`,
        };
        if (options.workflowDir && options.issueIdentifier) writeRunState(options.workflowDir, options.issueIdentifier, completed);
        if (!options.backgroundAgent) resolve(completed);
      } else {
        const exit = signal ?? code;
        const error = new Error(`agent command exited with ${exit}: ${command}`);
        error.agent = {
          command,
          pid: child.pid,
          logPath,
          status: "failed",
          event: `failed (${exit}): ${lastLine || path.relative(cwd, logPath)}`,
        };
        if (options.workflowDir && options.issueIdentifier) writeRunState(options.workflowDir, options.issueIdentifier, error.agent);
        if (!options.backgroundAgent) reject(error);
      }
    });
    if (options.backgroundAgent) resolve(started);
  });
}

export async function dispatchLinearIssue(apiKey, workflowMarkdown, issue, options = {}) {
  const config = parseWorkflowConfig(workflowMarkdown);
  const workflowDir = options.workflowDir ?? process.cwd();
  let activeIssue = { ...issue };
  const result = { issue: issue.identifier, state: issue.state };
  const existingRun = existingRunState(workflowDir, issue.identifier);
  if (existingRun?.status === "running" || existingRun?.status === "completed") {
    return { ...result, agent: existingRun, skipped: existingRun.status };
  }
  if (issue.state.toLowerCase() === "todo") {
    const stateId = await findStateId(apiKey, issue.teamId, "In Progress");
    if (!stateId) throw new Error(`No Linear workflow state named In Progress was found for team ${issue.teamId}.`);
    result.linear = await updateLinearIssueStatus(apiKey, issue.id, stateId);
    activeIssue.state = "In Progress";
  }
  const env = issueRuntimeEnv(config, activeIssue, { LINEAR_API_KEY: apiKey });
  const workspace = prepareWorkspace(config, activeIssue, {
    workflowDir,
    skipHooks: options.skipHooks,
    streamHookOutput: options["stream-agent-output"],
    env,
  });
  result.workspace = workspace.path;
  const workpadIssue = {
    key: activeIssue.identifier,
    status: activeIssue.state,
    acceptance: activeIssue.description || activeIssue.title,
  };
  result.workpad = await ensureLinearWorkpad(apiKey, activeIssue.id, workpadIssue, {
    branch: workspace.path,
    note: `Claimed by poller in ${workspace.path}.`,
  });
  if (!options.skipHooks) runHook(config.hooks.before_run, workspace.path, env);
  const prompt = issueScopedPrompt(workflowMarkdown, activeIssue, options.attempt ?? null);
  result.agent = await runAgentCommand(config.codex.command, workspace.path, prompt, env, {
    dryRunAgent: options.dryRunAgent,
    maxTurns: config.agent.max_turns,
    issueIdentifier: activeIssue.identifier,
    streamAgentOutput: options["stream-agent-output"],
    backgroundAgent: options["background-agent"],
    workflowDir,
  });
  if (!options.skipHooks) runHook(config.hooks.after_run, workspace.path, env);
  return result;
}

export async function pollLinearOnce(workflowPath, options = {}) {
  const workflowMarkdown = fs.readFileSync(workflowPath, "utf8");
  const config = parseWorkflowConfig(workflowMarkdown);
  const apiKey = requireValue(process.env.LINEAR_API_KEY, "LINEAR_API_KEY is required for polling.");
  const maxAgents = Number(options["max-concurrent-agents"] ?? config.agent.max_concurrent_agents);
  const candidates = await fetchLinearCandidateIssues(apiKey, config, {
    first: options["fetch-limit"] ?? Math.max(maxAgents * 2, 10),
  });
  const selected = candidates.slice(0, Math.max(0, maxAgents));
  const results = await Promise.all(selected.map((issue) => dispatchLinearIssue(apiKey, workflowMarkdown, issue, {
      workflowDir: path.dirname(path.resolve(workflowPath)),
      dryRunAgent: options["dry-run-agent"],
      skipHooks: options["skip-hooks"],
      "background-agent": options["background-agent"],
      "stream-agent-output": options["stream-agent-output"],
    })));
  return { candidates: candidates.length, dispatched: results.length, results };
}

function dashboardSnapshot(workflow, options = {}) {
  if (!fs.existsSync(workflow)) return options.empty ?? "No workflow.md";
  const workflowMarkdown = fs.readFileSync(workflow, "utf8");
  const config = parseWorkflowConfig(workflowMarkdown);
  return formatDashboard(parseWorkflow(workflowMarkdown), {
    maxConcurrentAgents: options["max-concurrent-agents"] ?? config.agent.max_concurrent_agents,
    maxTurns: options["max-turns"] ?? config.agent.max_turns,
    projectUrl: options["project-url"],
    nextRefresh: options["next-refresh"],
    events: [...readRunEventsForWorkflow(workflow), ...(options.events ?? [])],
  });
}

function clearDashboardScreen(options = {}) {
  if (options["no-clear"]) return;
  process.stdout.write("\x1Bc");
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function promoteReadyIssuesToTodo(workflowPath, options = {}) {
  const workflowMarkdown = fs.readFileSync(workflowPath, "utf8");
  const issues = parseWorkflow(workflowMarkdown);
  const selected = readyIssues(issues).slice(0, Number(options["max-concurrent-agents"] ?? parseWorkflowConfig(workflowMarkdown).agent.max_concurrent_agents ?? 1));
  if (!selected.length) return [];
  const apiKey = requireValue(process.env.LINEAR_API_KEY, "LINEAR_API_KEY is required to promote ready issues.");
  const teamId = options["team-id"] ?? process.env.LINEAR_TEAM_ID ?? (await firstLinearTeam(apiKey))?.id;
  const stateId = await findStateId(apiKey, teamId, "Todo");
  if (!stateId) throw new Error(`No Linear workflow state named Todo was found for team ${teamId}.`);
  let updated = workflowMarkdown;
  const promoted = [];
  for (const issue of selected) {
    if (!issue.linearIssue) continue;
    await updateLinearIssueStatus(apiKey, issue.linearIssue, stateId);
    updated = updateWorkflowStatus(updated, issue.key, "Todo", issue.linearIssue);
    promoted.push(issue);
  }
  fs.writeFileSync(workflowPath, updated, "utf8");
  return promoted;
}

async function findLinearWorkpadComment(apiKey, issueId) {
  const query = `
    query IssueComments($id: String!) {
      issue(id: $id) {
        comments {
          nodes { id body }
        }
      }
    }
  `;
  const data = await graphql(apiKey, query, { id: issueId });
  return data.issue.comments.nodes.find((comment) => String(comment.body ?? "").includes(WORKPAD_HEADER)) ?? null;
}

async function createLinearComment(apiKey, issueId, body) {
  const mutation = `
    mutation CommentCreate($input: CommentCreateInput!) {
      commentCreate(input: $input) {
        success
        comment { id body }
      }
    }
  `;
  const data = await graphql(apiKey, mutation, { input: { issueId, body } });
  if (!data.commentCreate.success) throw new Error(`Linear commentCreate did not succeed for ${issueId}`);
  return data.commentCreate.comment;
}

async function updateLinearComment(apiKey, commentId, body) {
  const mutation = `
    mutation CommentUpdate($id: String!, $input: CommentUpdateInput!) {
      commentUpdate(id: $id, input: $input) {
        success
        comment { id body }
      }
    }
  `;
  const data = await graphql(apiKey, mutation, { id: commentId, input: { body } });
  if (!data.commentUpdate.success) throw new Error(`Linear commentUpdate did not succeed for ${commentId}`);
  return data.commentUpdate.comment;
}

export async function ensureLinearWorkpad(apiKey, issueId, issue, options = {}) {
  const existing = await findLinearWorkpadComment(apiKey, issueId);
  const note = options.note ?? `Entered ${issue.status}.`;
  if (existing) {
    const body = appendWorkpadNote(existing.body, note, options);
    return { action: "updated", comment: await updateLinearComment(apiKey, existing.id, body) };
  }
  const body = appendWorkpadNote(initialWorkpadBody(issue, options), note, options);
  return { action: "created", comment: await createLinearComment(apiKey, issueId, body) };
}

function parseOptions(args) {
  const values = { _: [] };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) {
      values._.push(arg);
      continue;
    }
    const key = arg.slice(2);
    if (["apply", "apply-linear", "checkout", "local-only", "hyperlink", "once", "dry-run-agent", "skip-hooks", "poll", "daemon", "watch", "no-clear", "open-tui", "debug", "stream-agent-output", "background-agent", "foreground-agent"].includes(key)) {
      values[key] = true;
    } else {
      values[key] = args[index + 1];
      index += 1;
    }
  }
  return values;
}

function parseEnvFileLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (!match) return null;
  let value = match[2].trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return [match[1], value];
}

export function loadEnvFile(filePath, env = process.env) {
  const resolved = path.resolve(filePath);
  for (const line of fs.readFileSync(resolved, "utf8").split(/\r?\n/)) {
    const parsed = parseEnvFileLine(line);
    if (parsed) env[parsed[0]] = parsed[1];
  }
  return resolved;
}

function runtimeEnvDirectory(options = {}) {
  return options.directory ?? process.env.LWO_RUNTIME_ENV_DIR ?? path.join(os.homedir(), ".codex", "linear-workflow-orchestrator", "env");
}

export function writeRuntimeEnvFile(env = process.env, options = {}) {
  const keys = ["LINEAR_API_KEY", "LINEAR_TEAM_ID", "LINEAR_PROJECT_URL", "LINEAR_WORKSPACE_URL"];
  const lines = [];
  for (const key of keys) {
    if (env[key]) lines.push(`${key}=${JSON.stringify(env[key])}`);
  }
  if (!lines.length) return null;
  const directory = runtimeEnvDirectory(options);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const filePath = path.join(directory, `session-${Date.now()}-${process.pid}.env`);
  fs.writeFileSync(filePath, `${lines.join("\n")}\n`, { mode: 0o600 });
  fs.chmodSync(filePath, 0o600);
  return filePath;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function appleScriptQuote(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function buildTuiLaunchCommand(workflow, options = {}) {
  const helper = options.helperPath ?? path.resolve(new URL(import.meta.url).pathname);
  const args = ["tui", path.resolve(workflow)];
  if (options["env-file"]) args.push("--env-file", path.resolve(options["env-file"]));
  if (options["interval-ms"]) args.push("--interval-ms", String(options["interval-ms"]));
  if (options["fetch-limit"]) args.push("--fetch-limit", String(options["fetch-limit"]));
  return [
    `cd ${shellQuote(process.cwd())}`,
    ["node", shellQuote(helper), ...args.map(shellQuote)].join(" "),
  ].join(" && ");
}

export function launchTerminalTui(workflow, options = {}) {
  const command = buildTuiLaunchCommand(workflow, options);
  if (process.platform === "darwin") {
    execFileSync("osascript", [
      "-e",
      `tell application "Terminal" to do script "${appleScriptQuote(command)}"`,
      "-e",
      `tell application "Terminal" to activate`,
    ], { stdio: "ignore" });
    return { launched: true, platform: "darwin" };
  }
  const terminal = process.env.TERMINAL || "x-terminal-emulator";
  const child = spawn(terminal, ["-e", "sh", "-lc", command], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  return { launched: true, platform: process.platform, terminal };
}

function requireValue(value, message) {
  if (!value) throw new Error(message);
  return value;
}

export function preflightQuestions(env = process.env) {
  return [
    {
      id: "execution_workspace",
      question: "Use GitHub issue branches or local worktrees?",
      options: ["github", "worktree"],
    },
    {
      id: "linear_credentials",
      question: "Where are Linear credentials?",
      options: [
        env.LINEAR_API_KEY && env.LINEAR_TEAM_ID ? "exported" : "not exported",
        "env-file",
        "user-input",
      ],
    },
    {
      id: "goal_mode",
      question: "Use goal mode?",
      options: ["on", "off"],
    },
    {
      id: "agent_limits",
      question: "Set max_concurrent_agents and max_turns.",
      options: ["3 agents / 20 turns", "10 agents / 20 turns", "custom"],
    },
  ];
}

export async function run(argv) {
  const [rawCommand, ...rest] = argv;
  const command = rawCommand ?? "statusline";
  const options = parseOptions(rest);
  if (options["env-file"]) loadEnvFile(options["env-file"]);
  if (command === "goal") {
    const goal = requireValue(options._.join(" "), "goal is required");
    const workflow = options.out ?? "WORKFLOW.md";
    fs.writeFileSync(workflow, buildWorkflow(goal, true, [], {
      maxConcurrentAgents: options["max-concurrent-agents"],
      maxTurns: options["max-turns"],
      workspaceRoot: options["workspace-root"],
      repoUrl: options["repo-url"],
      baseBranch: options["base-branch"],
      codexCommand: options["codex-command"],
    }), "utf8");
    fs.writeFileSync(workflow, updateStartupAnswers(fs.readFileSync(workflow, "utf8"), {
      workspace: options.workspace ?? "github",
      credentials: options.credentials ?? "exported",
      goalMode: "on",
      maxConcurrentAgents: options["max-concurrent-agents"] ?? 3,
      maxTurns: options["max-turns"] ?? 20,
    }), "utf8");
    const result = { workflow, goal, mode: "goal", linear: null, promoted: [], poll: null };
    if (options.apply || process.env.LINEAR_API_KEY) {
      const originalLog = console.log;
      console.log = () => {};
      try {
        await run(["sync-linear", workflow, "--apply"]);
      } finally {
        console.log = originalLog;
      }
      result.linear = { applied: true };
      result.promoted = await promoteReadyIssuesToTodo(workflow, options);
      if (options.poll || options.daemon) result.poll = await pollLinearOnce(workflow, options);
    }
    if (options["open-tui"]) {
      const envFile = options["env-file"] ?? writeRuntimeEnvFile();
      result.tui = launchTerminalTui(workflow, { ...options, "env-file": envFile });
      if (envFile) result.tui.envFile = envFile;
    }
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (command === "init") {
    const goal = requireValue(options._[0], "goal is required");
    fs.writeFileSync(options.out ?? "workflow.md", buildWorkflow(goal, parseBool(options["goal-mode"] ?? "off"), [], {
      maxConcurrentAgents: options["max-concurrent-agents"],
      maxTurns: options["max-turns"],
      workspaceRoot: options["workspace-root"],
      repoUrl: options["repo-url"],
      baseBranch: options["base-branch"],
      codexCommand: options["codex-command"],
    }), "utf8");
    console.log(`wrote ${options.out ?? "workflow.md"}`);
    return;
  }
  if (command === "parse") {
    const workflow = requireValue(options._[0], "workflow path is required");
    console.log(JSON.stringify(parseWorkflow(fs.readFileSync(workflow, "utf8")), null, 2));
    return;
  }
  if (command === "preflight") {
    console.log(JSON.stringify(preflightQuestions(), null, 2));
    return;
  }
  if (command === "record-preflight") {
    const workflow = requireValue(options._[0], "workflow path is required");
    const workspace = requireValue(options.workspace, "--workspace is required");
    const credentials = requireValue(options.credentials, "--credentials is required");
    const goalMode = requireValue(options["goal-mode"], "--goal-mode is required");
    const maxConcurrentAgents = Number(options["max-concurrent-agents"] ?? parseWorkflowConfig(fs.readFileSync(workflow, "utf8")).agent.max_concurrent_agents);
    const maxTurns = Number(options["max-turns"] ?? parseWorkflowConfig(fs.readFileSync(workflow, "utf8")).agent.max_turns);
    if (!["github", "worktree"].includes(workspace)) throw new Error("--workspace must be github or worktree");
    if (!["exported", "env-file", "user-input"].includes(credentials)) throw new Error("--credentials must be exported, env-file, or user-input");
    parseBool(goalMode);
    if (!Number.isInteger(maxConcurrentAgents) || maxConcurrentAgents < 1) throw new Error("--max-concurrent-agents must be a positive integer");
    if (!Number.isInteger(maxTurns) || maxTurns < 1) throw new Error("--max-turns must be a positive integer");
    let updated = updateStartupAnswers(fs.readFileSync(workflow, "utf8"), { workspace, credentials, goalMode, maxConcurrentAgents, maxTurns });
    updated = updateWorkflowAgentConfig(updated, { maxConcurrentAgents, maxTurns });
    fs.writeFileSync(workflow, updated, "utf8");
    console.log(JSON.stringify({ workflow, workspace, credentials, goalMode, maxConcurrentAgents, maxTurns }, null, 2));
    return;
  }
  if (command === "sync-linear") {
    const workflow = requireValue(options._[0], "workflow path is required");
    const workflowMarkdown = fs.readFileSync(workflow, "utf8");
    requireStartupAnswers(workflowMarkdown);
    const apiKey = process.env.LINEAR_API_KEY;
    let teamId = options["team-id"] ?? process.env.LINEAR_TEAM_ID;
    let projectUrl = options["project-url"] ?? process.env.LINEAR_PROJECT_URL;
    let projectId = null;
    let context = null;
    let stateId = null;
    if (options.apply) {
      requireValue(apiKey, "LINEAR_API_KEY is required when --apply is used.");
      context = await resolveLinearContext(apiKey, workflowMarkdown, options);
      teamId = context.teamId;
      projectUrl = context.projectUrl;
      projectId = context.projectId;
      stateId = await findStateId(apiKey, teamId, "Backlog");
    } else {
      requireValue(teamId, "LINEAR_TEAM_ID is required for dry-run payload generation. Use --apply with LINEAR_API_KEY to auto-resolve a team.");
    }
    const pendingIssues = parseWorkflow(workflowMarkdown).filter((issue) => !issue.linearIssue);
    const issueInputs = buildIssueInputs(pendingIssues, workflow, teamId, projectUrl, stateId, projectId);
    if (options.apply) {
      const createdIssues = await createLinearIssues(apiKey, issueInputs);
      const createdIssuesByKey = new Map(
        pendingIssues.map((issue, index) => [issue.key, createdIssues[index]?.identifier]).filter((entry) => entry[1]),
      );
      let updated = updateWorkflowLinearIssues(workflowMarkdown, createdIssuesByKey);
      updated = updateWorkflowTrackerProject(updated, context?.project);
      fs.writeFileSync(workflow, updated, "utf8");
      console.log(JSON.stringify(createdIssues, null, 2));
    } else {
      const dryRun = { endpoint: LINEAR_ENDPOINT, teamId, projectURL: projectUrl, issues: issueInputs };
      if (options["dry-run-out"]) {
        fs.writeFileSync(options["dry-run-out"], JSON.stringify(dryRun, null, 2), "utf8");
        console.log(`wrote ${options["dry-run-out"]}`);
      } else {
        console.log(JSON.stringify(dryRun, null, 2));
      }
    }
    return;
  }
  if (command === "resolve-linear") {
    const workflow = options._[0] ?? "workflow.md";
    const workflowMarkdown = fs.existsSync(workflow) ? fs.readFileSync(workflow, "utf8") : "";
    const apiKey = requireValue(process.env.LINEAR_API_KEY, "LINEAR_API_KEY is required.");
    const context = await resolveLinearContext(apiKey, workflowMarkdown, options);
    console.log(JSON.stringify(context, null, 2));
    return;
  }
  if (command === "ready") {
    const workflow = requireValue(options._[0], "workflow path is required");
    console.log(JSON.stringify(readyIssues(parseWorkflow(fs.readFileSync(workflow, "utf8"))), null, 2));
    return;
  }
  if (command === "wave") {
    const workflow = requireValue(options._[0], "workflow path is required");
    const workflowMarkdown = fs.readFileSync(workflow, "utf8");
    const config = parseWorkflowConfig(workflowMarkdown);
    console.log(JSON.stringify(parallelWave(parseWorkflow(workflowMarkdown), {
      maxConcurrentAgents: options["max-concurrent-agents"] ?? config.agent.max_concurrent_agents,
    }), null, 2));
    return;
  }
  if (command === "select-issue") {
    const [workflow, issueKey] = options._;
    requireValue(workflow, "workflow path is required");
    requireValue(issueKey, "issue key is required");
    const workflowMarkdown = fs.readFileSync(workflow, "utf8");
    requireStartupAnswers(workflowMarkdown);
    const issue = issueByKey(workflowMarkdown, issueKey);
    requireLinearIssue(issue, options);
    if (issue.lane.toLowerCase() === "serial" && hasActiveSerialIssue(parseWorkflow(workflowMarkdown), issueKey)) {
      throw new Error("another serial issue is already active; finish it before selecting another serial issue");
    }
    const readyKeys = new Set(readyIssues(parseWorkflow(workflowMarkdown)).map((item) => item.key));
    if (!readyKeys.has(issueKey) && issue.status.toLowerCase() !== "todo") {
      throw new Error(`issue ${issueKey} is not ready; dependencies must be Done before selecting`);
    }
    fs.writeFileSync(workflow, updateWorkflowStatus(workflowMarkdown, issueKey, "Todo", issue.linearIssue), "utf8");
    const result = { workflow, issueKey, status: "Todo", linearIssue: issue.linearIssue || null };
    if (options["apply-linear"]) {
      const apiKey = requireValue(process.env.LINEAR_API_KEY, "LINEAR_API_KEY is required when --apply-linear is used.");
      const teamId = requireValue(options["team-id"] ?? process.env.LINEAR_TEAM_ID, "LINEAR_TEAM_ID is required when --apply-linear is used.");
      const linearIssue = requireValue(issue.linearIssue, "Linear issue identifier is required before applying Linear status updates.");
      const stateId = await findStateId(apiKey, teamId, "Todo");
      if (!stateId) throw new Error("No Linear workflow state named Todo was found.");
      result.linear = await updateLinearIssueStatus(apiKey, linearIssue, stateId);
    }
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (command === "start-issue") {
    const [workflow, issueKey] = options._;
    requireValue(workflow, "workflow path is required");
    requireValue(issueKey, "issue key is required");
    const mode = options.mode ?? "github";
    if (!["github", "worktree"].includes(mode)) throw new Error("--mode must be github or worktree");
    let workflowMarkdown = fs.readFileSync(workflow, "utf8");
    requireStartupAnswers(workflowMarkdown);
    const issue = issueByKey(workflowMarkdown, issueKey);
    requireLinearIssue(issue, options);
    if (issue.status.toLowerCase() !== "todo") {
      throw new Error(`issue ${issueKey} must be Todo before starting; run select-issue first`);
    }
    const branchName = options.branch ?? branchNameForIssue(issue);
    const worktreePath = options["worktree-dir"] ?? path.join("..", `${path.basename(process.cwd())}-${slugifyBranchPart(issue.linearIssue || issue.key)}`);
    const branchOrWorktree = mode === "worktree" ? worktreePath : branchName;
    workflowMarkdown = updateWorkflowStatus(workflowMarkdown, issueKey, "In Progress", issue.linearIssue);
    workflowMarkdown = updateWorkflowBranch(workflowMarkdown, issueKey, branchOrWorktree);
    let targetWorkflow = workflow;
    const result = { workflow, issueKey, status: "In Progress", mode, branch: branchName, worktree: mode === "worktree" ? worktreePath : null };
    if (options.checkout) {
      const base = options.base ?? "main";
      if (mode === "github") {
        execFileSync("git", ["checkout", "-B", branchName, base], { stdio: "inherit" });
      } else {
        execFileSync("git", ["worktree", "add", "-B", branchName, worktreePath, base], { stdio: "inherit" });
        const workflowRelativePath = path.relative(process.cwd(), path.resolve(workflow));
        targetWorkflow = path.join(worktreePath, workflowRelativePath);
      }
      result.checkedOut = true;
    }
    fs.writeFileSync(workflow, workflowMarkdown, "utf8");
    if (targetWorkflow !== workflow) fs.writeFileSync(targetWorkflow, workflowMarkdown, "utf8");
    result.workflow = targetWorkflow;
    if (options["apply-linear"]) {
      const apiKey = requireValue(process.env.LINEAR_API_KEY, "LINEAR_API_KEY is required when --apply-linear is used.");
      const teamId = requireValue(options["team-id"] ?? process.env.LINEAR_TEAM_ID, "LINEAR_TEAM_ID is required when --apply-linear is used.");
      const linearIssue = requireValue(issue.linearIssue, "Linear issue identifier is required before applying Linear status updates.");
      const stateId = await findStateId(apiKey, teamId, "In Progress");
      if (!stateId) throw new Error("No Linear workflow state named In Progress was found.");
      result.linear = await updateLinearIssueStatus(apiKey, linearIssue, stateId);
      result.workpad = await ensureLinearWorkpad(apiKey, linearIssue, { ...issue, status: "In Progress" }, {
        branch: branchOrWorktree,
        note: options["workpad-note"] ?? `Started active work in ${branchOrWorktree}.`,
      });
    }
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (command === "workpad") {
    const [workflow, issueKey] = options._;
    requireValue(workflow, "workflow path is required");
    requireValue(issueKey, "issue key is required");
    const workflowMarkdown = fs.readFileSync(workflow, "utf8");
    const issue = issueByKey(workflowMarkdown, issueKey);
    const apiKey = requireValue(process.env.LINEAR_API_KEY, "LINEAR_API_KEY is required for workpad updates.");
    const linearIssue = requireValue(options["linear-issue"] ?? issue.linearIssue, "Linear issue identifier is required for workpad updates.");
    const note = options.note ?? `Updated ${issue.status}.`;
    const result = {
      workflow,
      issueKey,
      linearIssue,
      workpad: await ensureLinearWorkpad(apiKey, linearIssue, issue, { branch: issue.branch, note }),
    };
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (command === "statusline") {
    const workflow = options._[0] ?? "workflow.md";
    if (!fs.existsSync(workflow)) {
      console.log(options.empty ?? "");
      return;
    }
    const issue = currentIssue(parseWorkflow(fs.readFileSync(workflow, "utf8")));
    if (options.json) {
      console.log(JSON.stringify(issue ?? {}, null, 2));
    } else {
      console.log(formatStatusLine(issue, {
        maxTitle: options["max-title"],
        empty: options.empty,
        hyperlink: options.hyperlink,
        linearBaseUrl: options["linear-base-url"],
        projectUrl: options["project-url"],
      }));
    }
    return;
  }
  if (command === "dashboard") {
    const workflow = options._[0] ?? "workflow.md";
    while (true) {
      if (options.watch) clearDashboardScreen(options);
      console.log(dashboardSnapshot(workflow, options));
      if (!options.watch || options.once) return;
      const interval = Number(options["interval-ms"] ?? 2000);
      await sleep(interval);
    }
  }
  if (command === "run" || command === "tui") {
    const workflow = options._[0] ?? "WORKFLOW.md";
    let events = [];
    while (true) {
      clearDashboardScreen(options);
      console.log(dashboardSnapshot(workflow, { ...options, events }));
      const startedAt = new Date().toISOString();
      try {
        const result = await pollLinearOnce(workflow, {
          ...options,
          "background-agent": !options["foreground-agent"],
        });
        events = result.results.map((item) => ({
          id: item.issue,
          issue: item.issue,
          pid: item.agent?.pid,
          event: item.agent?.event ?? `dispatched ${item.issue}`,
        }));
        if (options.debug) console.log(JSON.stringify({ startedAt, ...result }, null, 2));
      } catch (error) {
        events = [{
          id: "error",
          issue: "error",
          event: error.agent?.event ?? error.message,
          pid: error.agent?.pid,
        }];
        if (options.debug) console.error(JSON.stringify({ startedAt, error: error.message, agent: error.agent }, null, 2));
      }
      if (options.once) return;
      const config = fs.existsSync(workflow) ? parseWorkflowConfig(fs.readFileSync(workflow, "utf8")) : { polling: {} };
      const interval = Number(options["interval-ms"] ?? config.polling.interval_ms ?? 30000);
      await sleep(interval);
    }
  }
  if (command === "open-tui") {
    const workflow = options._[0] ?? "WORKFLOW.md";
    const envFile = options["env-file"] ?? writeRuntimeEnvFile();
    console.log(JSON.stringify({
      workflow,
      envFile,
      ...launchTerminalTui(workflow, { ...options, "env-file": envFile }),
    }, null, 2));
    return;
  }
  if (command === "poll") {
    const workflow = options._[0] ?? "WORKFLOW.md";
    console.log(JSON.stringify(await pollLinearOnce(workflow, options), null, 2));
    return;
  }
  if (command === "daemon") {
    const workflow = options._[0] ?? "WORKFLOW.md";
    while (true) {
      const startedAt = new Date().toISOString();
      try {
        const result = await pollLinearOnce(workflow, options);
        console.log(JSON.stringify({ startedAt, ...result }, null, 2));
      } catch (error) {
        console.error(JSON.stringify({ startedAt, error: error.message }));
      }
      if (options.once) return;
      const config = parseWorkflowConfig(fs.readFileSync(workflow, "utf8"));
      const interval = Number(options["interval-ms"] ?? config.polling.interval_ms ?? 30000);
      await sleep(interval);
    }
  }
  if (command === "set-status") {
    const [workflow, issueKey, status] = options._;
    requireValue(workflow, "workflow path is required");
    requireValue(issueKey, "issue key is required");
    requireValue(status, "status is required");
    const workflowMarkdown = fs.readFileSync(workflow, "utf8");
    const issue = issueByKey(workflowMarkdown, issueKey);
    assertStatusTransition(issue, status, options);
    const updated = updateWorkflowStatus(workflowMarkdown, issueKey, status, options["linear-issue"]);
    fs.writeFileSync(workflow, updated, "utf8");
    const result = { workflow, issueKey, status, linearIssue: options["linear-issue"] ?? null };
    if (options["apply-linear"]) {
      const apiKey = requireValue(process.env.LINEAR_API_KEY, "LINEAR_API_KEY is required when --apply-linear is used.");
      const teamId = requireValue(options["team-id"] ?? process.env.LINEAR_TEAM_ID, "LINEAR_TEAM_ID is required when --apply-linear is used.");
      const linearIssue = requireValue(options["linear-issue"], "--linear-issue is required when --apply-linear is used.");
      const stateId = await findStateId(apiKey, teamId, status);
      if (!stateId) throw new Error(`No Linear workflow state named ${status} was found for team ${teamId}.`);
      result.linear = await updateLinearIssueStatus(apiKey, linearIssue, stateId);
      result.workpad = await ensureLinearWorkpad(apiKey, linearIssue, { ...issue, status }, {
        branch: issue.branch,
        note: options["workpad-note"] ?? `Moved to ${status}.`,
      });
    }
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  throw new Error(`unknown command: ${command ?? "(none)"}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
