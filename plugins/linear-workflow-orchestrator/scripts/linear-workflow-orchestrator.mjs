#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

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

export function buildWorkflow(goal, goalMode, extraStatuses = []) {
  const statusRows = [
    ...DEFAULT_STATUSES,
    ...extraStatuses.map((status) => [status, "User-defined status."]),
  ];
  const issues = [
    {
      key: "LWO-001",
      title: "Clarify workflow scope and authority",
      lane: "serial",
      dependsOn: [],
      status: "Backlog",
      acceptance: "Goal, goal mode, GitHub authority, and Linear authority are explicit.",
      linearIssue: "",
      branch: "",
    },
    {
      key: "LWO-002",
      title: "Create implementation workflow",
      lane: "serial",
      dependsOn: ["LWO-001"],
      status: "Backlog",
      acceptance: "workflow.md describes tasks, dependencies, statuses, and acceptance criteria.",
      linearIssue: "",
      branch: "",
    },
    {
      key: "LWO-003",
      title: "Register Linear backlog",
      lane: "serial",
      dependsOn: ["LWO-002"],
      status: "Backlog",
      acceptance: "Linear issues are created or a dry-run payload is available for review.",
      linearIssue: "",
      branch: "",
    },
    {
      key: "LWO-004",
      title: "Execute independent implementation lanes",
      lane: "parallel",
      dependsOn: ["LWO-003"],
      status: "Backlog",
      acceptance: "Parallel-ready tasks are implemented without violating dependencies.",
      linearIssue: "",
      branch: "",
    },
    {
      key: "LWO-005",
      title: "Review, rework, and merge",
      lane: "serial",
      dependsOn: ["LWO-004"],
      status: "Backlog",
      acceptance: "Review findings are resolved and merge readiness is verified.",
      linearIssue: "",
      branch: "",
    },
  ];

  return [
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

export function parallelWave(issues) {
  return readyIssues(issues).filter((issue) => issue.lane.toLowerCase() === "parallel");
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
  return ["execution_workspace", "linear_credentials", "goal_mode"].every((key) => answers[key] && answers[key] !== "pending");
}

export function updateStartupAnswers(markdown, answers) {
  const rows = [
    `- Execution workspace: ${answers.workspace}`,
    `- Linear credentials: ${answers.credentials}`,
    `- Goal mode: ${answers.goalMode}`,
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
  return [
    `Generated by Linear Workflow Orchestrator from \`${workflowPath}\`.`,
    "",
    `- Workflow ID: \`${issue.key}\``,
    `- Lane: \`${issue.lane}\``,
    `- Depends on: ${deps}`,
    `- Initial orchestrator status: \`${issue.status}\``,
    "",
    "## Acceptance Criteria",
    "",
    issue.acceptance,
  ].join("\n");
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

function parseOptions(args) {
  const values = { _: [] };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) {
      values._.push(arg);
      continue;
    }
    const key = arg.slice(2);
    if (["apply", "apply-linear", "checkout", "local-only", "hyperlink"].includes(key)) {
      values[key] = true;
    } else {
      values[key] = args[index + 1];
      index += 1;
    }
  }
  return values;
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
  ];
}

export async function run(argv) {
  const [rawCommand, ...rest] = argv;
  const command = rawCommand ?? "statusline";
  const options = parseOptions(rest);
  if (command === "init") {
    const goal = requireValue(options._[0], "goal is required");
    fs.writeFileSync(options.out ?? "workflow.md", buildWorkflow(goal, parseBool(options["goal-mode"] ?? "off")), "utf8");
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
    if (!["github", "worktree"].includes(workspace)) throw new Error("--workspace must be github or worktree");
    if (!["exported", "env-file", "user-input"].includes(credentials)) throw new Error("--credentials must be exported, env-file, or user-input");
    parseBool(goalMode);
    const updated = updateStartupAnswers(fs.readFileSync(workflow, "utf8"), { workspace, credentials, goalMode });
    fs.writeFileSync(workflow, updated, "utf8");
    console.log(JSON.stringify({ workflow, workspace, credentials, goalMode }, null, 2));
    return;
  }
  if (command === "sync-linear") {
    const workflow = requireValue(options._[0], "workflow path is required");
    const workflowMarkdown = fs.readFileSync(workflow, "utf8");
    requireStartupAnswers(workflowMarkdown);
    const teamId = options["team-id"] ?? process.env.LINEAR_TEAM_ID;
    const projectUrl = options["project-url"] ?? process.env.LINEAR_PROJECT_URL;
    requireValue(teamId, "LINEAR_TEAM_ID is required for Linear sync or dry-run payload generation.");
    const apiKey = process.env.LINEAR_API_KEY;
    let stateId = null;
    let projectId = null;
    if (options.apply) {
      requireValue(apiKey, "LINEAR_API_KEY is required when --apply is used.");
      stateId = await findStateId(apiKey, teamId, "Backlog");
      projectId = await findProjectId(apiKey, teamId, projectUrl);
    }
    const pendingIssues = parseWorkflow(workflowMarkdown).filter((issue) => !issue.linearIssue);
    const issueInputs = buildIssueInputs(pendingIssues, workflow, teamId, projectUrl, stateId, projectId);
    if (options.apply) {
      const createdIssues = await createLinearIssues(apiKey, issueInputs);
      const createdIssuesByKey = new Map(
        pendingIssues.map((issue, index) => [issue.key, createdIssues[index]?.identifier]).filter((entry) => entry[1]),
      );
      fs.writeFileSync(workflow, updateWorkflowLinearIssues(workflowMarkdown, createdIssuesByKey), "utf8");
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
  if (command === "ready") {
    const workflow = requireValue(options._[0], "workflow path is required");
    console.log(JSON.stringify(readyIssues(parseWorkflow(fs.readFileSync(workflow, "utf8"))), null, 2));
    return;
  }
  if (command === "wave") {
    const workflow = requireValue(options._[0], "workflow path is required");
    console.log(JSON.stringify(parallelWave(parseWorkflow(fs.readFileSync(workflow, "utf8"))), null, 2));
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
    }
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
