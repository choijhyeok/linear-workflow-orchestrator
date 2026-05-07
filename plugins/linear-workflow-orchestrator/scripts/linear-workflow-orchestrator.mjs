#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

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
  return `| ${issue.key} | ${issue.title} | ${issue.lane} | ${deps} | ${issue.status} | ${linearIssue} | ${issue.acceptance} |`;
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
    },
    {
      key: "LWO-002",
      title: "Create implementation workflow",
      lane: "serial",
      dependsOn: ["LWO-001"],
      status: "Backlog",
      acceptance: "workflow.md describes tasks, dependencies, statuses, and acceptance criteria.",
      linearIssue: "",
    },
    {
      key: "LWO-003",
      title: "Register Linear backlog",
      lane: "serial",
      dependsOn: ["LWO-002"],
      status: "Backlog",
      acceptance: "Linear issues are created or a dry-run payload is available for review.",
      linearIssue: "",
    },
    {
      key: "LWO-004",
      title: "Execute independent implementation lanes",
      lane: "parallel",
      dependsOn: ["LWO-003"],
      status: "Backlog",
      acceptance: "Parallel-ready tasks are implemented without violating dependencies.",
      linearIssue: "",
    },
    {
      key: "LWO-005",
      title: "Review, rework, and merge",
      lane: "serial",
      dependsOn: ["LWO-004"],
      status: "Backlog",
      acceptance: "Review findings are resolved and merge readiness is verified.",
      linearIssue: "",
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
    "## Authority Checklist",
    "",
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
    "| ID | Title | Lane | Depends On | Status | Linear Issue | Acceptance Criteria |",
    "| --- | --- | --- | --- | --- | --- | --- |",
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
    if (row.length !== 7 || row[0] === "ID" || row[0] === "---") continue;
    issues.push({
      key: row[0],
      title: row[1],
      lane: row[2],
      dependsOn: row[3].split(",").map((dep) => dep.trim()).filter((dep) => dep && dep !== "-"),
      status: row[4],
      linearIssue: row[5] === "-" ? "" : row[5],
      acceptance: row[6],
    });
  }
  return issues;
}

export function currentIssue(issues) {
  for (const status of ACTIVE_STATUS_PRIORITY) {
    const match = issues.find((issue) => issue.status.toLowerCase() === status.toLowerCase());
    if (match) return match;
  }
  return issues.find((issue) => !["done", "canceled", "duplicate"].includes(issue.status.toLowerCase())) ?? null;
}

export function formatStatusLine(issue, options = {}) {
  if (!issue) return options.empty ?? "Linear: no active workflow";
  const maxTitle = Number(options.maxTitle ?? 64);
  const title = issue.title.length > maxTitle ? `${issue.title.slice(0, Math.max(0, maxTitle - 1))}…` : issue.title;
  const linear = issue.linearIssue ? ` · ${issue.linearIssue}` : "";
  return `Linear ${issue.status}: ${issue.key} ${title}${linear}`;
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
      if (row.length === 7 && row[0] === issueKey) {
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
      if (row.length === 7 && createdIssuesByKey.has(row[0])) {
        row[5] = createdIssuesByKey.get(row[0]);
        return `| ${row.join(" | ")} |`;
      }
    }
    return line;
  }).join("\n");
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
    if (["apply", "apply-linear"].includes(key)) {
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
  if (command === "sync-linear") {
    const workflow = requireValue(options._[0], "workflow path is required");
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
    const workflowMarkdown = fs.readFileSync(workflow, "utf8");
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
      console.log(formatStatusLine(issue, { maxTitle: options["max-title"], empty: options.empty }));
    }
    return;
  }
  if (command === "set-status") {
    const [workflow, issueKey, status] = options._;
    requireValue(workflow, "workflow path is required");
    requireValue(issueKey, "issue key is required");
    requireValue(status, "status is required");
    const updated = updateWorkflowStatus(fs.readFileSync(workflow, "utf8"), issueKey, status, options["linear-issue"]);
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
