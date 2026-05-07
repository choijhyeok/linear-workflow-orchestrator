import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  authorizationHeader,
  buildIssueInputs,
  buildWorkflow,
  currentIssue,
  formatDashboard,
  formatStatusLine,
  initialWorkpadBody,
  linearIssueUrl,
  parseWorkflow,
  parseWorkflowConfig,
  pollLinearOnce,
  prepareWorkspace,
  preflightQuestions,
  projectIdFromUrl,
  branchNameForIssue,
  parallelWave,
  readyIssues,
  updateStartupAnswers,
  updateWorkflowAgentConfig,
  updateWorkflowTrackerProject,
  updateWorkflowBranch,
  updateWorkflowLinearIssues,
  updateWorkflowStatus,
  run,
} from "../plugins/linear-workflow-orchestrator/scripts/linear-workflow-orchestrator.mjs";

function executableWorkflow(goal = "Build a Linear-managed Codex plugin") {
  return updateWorkflowLinearIssues(
    updateStartupAnswers(buildWorkflow(goal, false), {
      workspace: "github",
      credentials: "exported",
      goalMode: "off",
    }),
    new Map([["LWO-001", "HOW-1"], ["LWO-002", "HOW-2"], ["LWO-003", "HOW-3"], ["LWO-004", "HOW-4"], ["LWO-005", "HOW-5"]]),
  );
}

test("build and parse workflow round trip", () => {
  const workflow = buildWorkflow("Build bookmark CLI with add, list, remove", true);
  const issues = parseWorkflow(workflow);

  assert.equal(issues.length, 5);
  assert.equal(issues[0].key, "LWO-001");
  assert.equal(issues[0].title, "Scaffold bookmark CLI package and storage");
  assert.equal(issues[0].status, "Backlog");
  assert.equal(issues[0].branch, "");
  assert.deepEqual(issues[1].dependsOn, ["LWO-001"]);
  assert.deepEqual(issues[4].dependsOn, ["LWO-002", "LWO-003", "LWO-004"]);
  assert.match(workflow, /Goal mode: on/);
  assert.match(workflow, /Branch\/Worktree/);
  assert.match(workflow, /agent:\n  max_concurrent_agents: 3\n  max_turns: 20/);
});

test("generic workflow issues are feature slices, not orchestration chores", () => {
  const workflow = buildWorkflow("Add Telegram proposal confirmation", true);
  const titles = parseWorkflow(workflow).map((issue) => issue.title).join("\n");

  assert.doesNotMatch(titles, /Clarify workflow scope|Register Linear backlog|Review, rework, and merge/);
  assert.match(titles, /Implement core behavior/);
});

test("workflow config parses agent concurrency and turn budget", () => {
  const config = parseWorkflowConfig(buildWorkflow("Build a Linear-managed Codex plugin", true, [], {
    maxConcurrentAgents: 10,
    maxTurns: 20,
    repoUrl: "https://github.com/choijhyeok/test-work.git",
    baseBranch: "main",
    codexCommand: "codex app-server",
  }));

  assert.equal(config.tracker.kind, "linear");
  assert.equal(config.agent.max_concurrent_agents, 10);
  assert.equal(config.agent.max_turns, 20);
  assert.equal(config.github.repo_url, "https://github.com/choijhyeok/test-work.git");
  assert.equal(config.github.base_branch, "main");
  assert.match(config.hooks.after_create, /SYMPHONY_ISSUE_BRANCH/);
  assert.equal(config.codex.command, "codex app-server");
});

test("workflow config parses lists and hook block scalars", () => {
  const workflow = [
    "---",
    "tracker:",
    "  kind: linear",
    "  active_states:",
    "    - Todo",
    "    - In Progress",
    "hooks:",
    "  after_create: |",
    "    git clone example .",
    "    npm install",
    "---",
    "Prompt",
  ].join("\n");
  const config = parseWorkflowConfig(workflow);

  assert.deepEqual(config.tracker.active_states, ["Todo", "In Progress"]);
  assert.equal(config.hooks.after_create, "git clone example .\nnpm install");
});

test("build issue inputs include dependencies and project uuid", () => {
  const issue = {
    key: "LWO-010",
    title: "Implement worker lane",
    lane: "parallel",
    dependsOn: ["LWO-001", "LWO-002"],
    status: "Todo",
    acceptance: "Worker lane is verified.",
    linearIssue: "",
  };

  const [payload] = buildIssueInputs(
    [issue],
    "workflow.md",
    "team-123",
    "https://linear.app/acme/project/example-12345678-1234-1234-1234-123456789abc",
    "state-456",
  );

  assert.equal(payload.teamId, "team-123");
  assert.equal(payload.stateId, "state-456");
  assert.equal(payload.projectId, "12345678-1234-1234-1234-123456789abc");
  assert.match(payload.description, /LWO-001, LWO-002/);
  assert.match(payload.description, /## Scope/);
  assert.match(payload.description, /## Validation/);
  assert.match(payload.description, /terminal TUI/);
  assert.equal(payload.title, "LWO-010: Implement worker lane");
});

test("build issue inputs prefer resolved project id for slug-only project URLs", () => {
  const [payload] = buildIssueInputs(
    [
      {
        key: "LWO-011",
        title: "Attach project by API lookup",
        lane: "serial",
        dependsOn: [],
        status: "Backlog",
        acceptance: "Resolved project id is used.",
        linearIssue: "",
      },
    ],
    "workflow.md",
    "team-123",
    "https://linear.app/acme/project/example-project-abcdef123456/issues",
    null,
    "project-456",
  );

  assert.equal(payload.projectId, "project-456");
});

test("project id parsing returns null without uuid", () => {
  assert.equal(projectIdFromUrl("https://linear.app/acme/project/no-uuid"), null);
});

test("authorization header preserves api key and bearer token", () => {
  assert.equal(authorizationHeader("lin_api_abc"), "lin_api_abc");
  assert.equal(authorizationHeader("Bearer token"), "Bearer token");
});

test("preflight questions cover workspace credentials and goal mode", () => {
  const questions = preflightQuestions({ LINEAR_API_KEY: "key", LINEAR_TEAM_ID: "team" });

  assert.deepEqual(questions.map((question) => question.id), ["execution_workspace", "linear_credentials", "goal_mode", "agent_limits"]);
  assert.equal(questions[1].options[0], "exported");
});

test("skill requires startup questions before repository work", () => {
  const skill = readFileSync(join(import.meta.dirname, "../plugins/linear-workflow-orchestrator/skills/linear-workflow-orchestrator/SKILL.md"), "utf8");

  assert.match(skill, /Hard gate: ask these four questions before repository inspection/);
  assert.match(skill, /Do not infer or auto-select the answers/);
  assert.match(skill, /first assistant response for a new `\$linear-workflow-orchestrator` request must be only the startup-question prompt/);
});

test("record-preflight stores startup agent limits", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "lwo-preflight-limits-"));
  const workflowPath = join(tempDir, "WORKFLOW.md");
  const originalLog = console.log;
  console.log = () => {};
  writeFileSync(workflowPath, buildWorkflow("Build a Linear-managed Codex plugin", true, [], {
    maxConcurrentAgents: 10,
    maxTurns: 20,
  }));

  try {
    await run([
      "record-preflight",
      workflowPath,
      "--workspace",
      "github",
      "--credentials",
      "exported",
      "--goal-mode",
      "on",
      "--max-concurrent-agents",
      "10",
      "--max-turns",
      "20",
    ]);
    const workflow = readFileSync(workflowPath, "utf8");
    assert.match(workflow, /Max concurrent agents: 10/);
    assert.match(workflow, /Max turns: 20/);
  } finally {
    console.log = originalLog;
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("skill requires Linear handoff after dry-run or failed apply", () => {
  const skill = readFileSync(join(import.meta.dirname, "../plugins/linear-workflow-orchestrator/skills/linear-workflow-orchestrator/SKILL.md"), "utf8");

  assert.match(skill, /After a dry-run or failed Linear apply, do not continue as though Linear orchestration is complete/);
  assert.match(skill, /ask whether to run Linear registration now/);
  assert.match(skill, /Do not mark Linear-backed issues Done or present the workflow as fully complete while `Linear Issue` cells are empty/);
});

test("skill routes goal mode to terminal TUI instead of manual status prompts", () => {
  const skill = readFileSync(join(import.meta.dirname, "../plugins/linear-workflow-orchestrator/skills/linear-workflow-orchestrator/SKILL.md"), "utf8");

  assert.match(skill, /Terminal TUI: owns the Linear execution queue after bootstrap/);
  assert.match(skill, /Do not replace the TUI with repeated Codex-side `set-status \.\.\. --apply-linear` calls/);
  assert.match(skill, /do not ask the user whether to move routine implementation issues to Done/);
});

test("update workflow status changes matching row", () => {
  const workflow = buildWorkflow("Build a Linear-managed Codex plugin", true);
  const updated = updateWorkflowStatus(workflow, "LWO-004", "In Progress", "ABC-123");
  const issue = parseWorkflow(updated).find((item) => item.key === "LWO-004");

  assert.equal(issue.status, "In Progress");
  assert.equal(issue.linearIssue, "ABC-123");
});

test("update workflow branch records the issue execution branch", () => {
  const workflow = buildWorkflow("Build a Linear-managed Codex plugin", true);
  const updated = updateWorkflowBranch(workflow, "LWO-004", "issue/abc-123-implement");
  const issue = parseWorkflow(updated).find((item) => item.key === "LWO-004");

  assert.equal(issue.branch, "issue/abc-123-implement");
});

test("update workflow linear issues records created identifiers", () => {
  const workflow = buildWorkflow("Build a Linear-managed Codex plugin", true);
  const updated = updateWorkflowLinearIssues(workflow, new Map([["LWO-002", "LWO-200"]]));
  const issues = parseWorkflow(updated);

  assert.equal(issues.find((item) => item.key === "LWO-001").linearIssue, "");
  assert.equal(issues.find((item) => item.key === "LWO-002").linearIssue, "LWO-200");
});

test("update workflow tracker project records created project slug", () => {
  const workflow = buildWorkflow("Build a Linear-managed Codex plugin", true);
  const updated = updateWorkflowTrackerProject(workflow, { slugId: "abc123" });

  assert.match(updated, /project_slug: "abc123"/);
});

test("record-preflight updates front matter agent limits", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "lwo-agent-config-"));
  const workflowPath = join(tempDir, "WORKFLOW.md");
  writeFileSync(workflowPath, buildWorkflow("Build a Linear-managed Codex plugin", true));
  const originalLog = console.log;
  console.log = () => {};

  try {
    await run([
      "record-preflight",
      workflowPath,
      "--workspace",
      "github",
      "--credentials",
      "exported",
      "--goal-mode",
      "on",
      "--max-concurrent-agents",
      "8",
      "--max-turns",
      "12",
    ]);
    const config = parseWorkflowConfig(readFileSync(workflowPath, "utf8"));
    assert.equal(config.agent.max_concurrent_agents, 8);
    assert.equal(config.agent.max_turns, 12);
  } finally {
    console.log = originalLog;
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("update workflow agent config changes front matter limits", () => {
  const updated = updateWorkflowAgentConfig(buildWorkflow("Build a Linear-managed Codex plugin", true), {
    maxConcurrentAgents: 6,
    maxTurns: 9,
  });
  const config = parseWorkflowConfig(updated);

  assert.equal(config.agent.max_concurrent_agents, 6);
  assert.equal(config.agent.max_turns, 9);
});

test("ready issues only include dependency-satisfied backlog or todo work", () => {
  let workflow = buildWorkflow("Build a Linear-managed Codex plugin", true);
  let issues = readyIssues(parseWorkflow(workflow));
  assert.deepEqual(issues.map((issue) => issue.key), ["LWO-001"]);

  workflow = updateWorkflowStatus(workflow, "LWO-001", "Done");
  issues = readyIssues(parseWorkflow(workflow));
  assert.deepEqual(issues.map((issue) => issue.key), ["LWO-002", "LWO-003"]);
});

test("parallel wave only includes dependency-ready parallel work", () => {
  let workflow = buildWorkflow("Build bookmark CLI with add, list, remove", true);
  workflow = updateWorkflowStatus(workflow, "LWO-001", "Done");
  const wave = parallelWave(parseWorkflow(workflow));

  assert.deepEqual(wave.map((issue) => issue.key), ["LWO-002", "LWO-003", "LWO-004"]);
});

test("parallel wave respects max concurrent agent capacity", () => {
  const issues = [
    { key: "A", lane: "parallel", status: "Backlog", dependsOn: [] },
    { key: "B", lane: "parallel", status: "Backlog", dependsOn: [] },
    { key: "C", lane: "parallel", status: "Backlog", dependsOn: [] },
    { key: "D", lane: "serial", status: "In Progress", dependsOn: [] },
  ];

  assert.deepEqual(parallelWave(issues, { maxConcurrentAgents: 2 }).map((issue) => issue.key), ["A"]);
});

test("branch name uses Linear identifier when present", () => {
  assert.equal(
    branchNameForIssue({ key: "LWO-004", linearIssue: "HOW-76", title: "Build bookmark CLI example" }),
    "issue/how-76-build-bookmark-cli-example",
  );
});

test("statusline selects active issue by status priority", () => {
  const workflow = updateWorkflowStatus(
    buildWorkflow("Build a Linear-managed Codex plugin", true),
    "LWO-004",
    "In Progress",
    "ABC-123",
  );
  const line = formatStatusLine(currentIssue(parseWorkflow(workflow)));

  assert.equal(line, "Linear In Progress: LWO-004 Review and prepare merge for Build a Linear-managed Codex plugin · ABC-123");
});

test("statusline can hyperlink Linear issue identifiers", () => {
  const issue = {
    key: "LWO-004",
    title: "Build bookmark CLI example",
    status: "In Progress",
    linearIssue: "HOW-76",
  };
  const line = formatStatusLine(issue, { hyperlink: true, linearBaseUrl: "https://linear.app/choijhyeok/project/example/issues" });

  assert.equal(line, "Linear In Progress: LWO-004 Build bookmark CLI example · \u001B]8;;https://linear.app/choijhyeok/issue/HOW-76\u0007HOW-76\u001B]8;;\u0007");
});

test("linear issue urls are derived from Linear project URLs", () => {
  assert.equal(
    linearIssueUrl({ linearIssue: "HOW-76" }, { projectUrl: "https://linear.app/choijhyeok/project/hanwha-project-5f527568b378/issues" }),
    "https://linear.app/choijhyeok/issue/HOW-76",
  );
});

test("workpad body records issue acceptance and progress", () => {
  const body = initialWorkpadBody({
    key: "LWO-004",
    status: "In Progress",
    acceptance: "Bookmark commands are tested.",
  }, { branch: "issue/how-76-bookmarks", now: "2026-05-07T00:00:00.000Z" });

  assert.match(body, /## Codex Workpad/);
  assert.match(body, /### Environment/);
  assert.match(body, /Bookmark commands are tested/);
  assert.match(body, /### Validation/);
  assert.match(body, /### Review \/ Merge/);
  assert.match(body, /issue\/how-76-bookmarks/);
});

test("prepare workspace exposes issue branch env to hooks", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "lwo-hook-env-"));
  const config = {
    workspace: { root: join(tempDir, "workspaces") },
    github: { repo_url: "https://github.com/acme/example.git", base_branch: "main" },
    hooks: {
      after_create: "printf '%s\\n%s\\n%s\\n' \"$SYMPHONY_ISSUE_BRANCH\" \"$SYMPHONY_BASE_BRANCH\" \"$SYMPHONY_REPO_URL\" > hook-env.txt",
    },
  };

  try {
    const workspace = prepareWorkspace(config, {
      id: "issue-id",
      identifier: "ABC-123",
      title: "Build bookmark CLI",
    }, { workflowDir: tempDir });
    const output = readFileSync(join(workspace.path, "hook-env.txt"), "utf8");
    assert.match(output, /issue\/abc-123-build-bookmark-cli/);
    assert.match(output, /main/);
    assert.match(output, /https:\/\/github\.com\/acme\/example\.git/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("dashboard summarizes active workflow issues", () => {
  const workflow = updateWorkflowStatus(
    updateWorkflowStatus(buildWorkflow("Build a Linear-managed Codex plugin", true), "LWO-001", "Done"),
    "LWO-002",
    "In Progress",
    "HOW-2",
  );
  const dashboard = formatDashboard(parseWorkflow(workflow), {
    maxConcurrentAgents: 3,
    maxTurns: 20,
    projectUrl: "https://linear.app/acme/project/example/issues",
    nextRefresh: "manual",
  });

  assert.match(dashboard, /SYMPHONY STATUS/);
  assert.match(dashboard, /Agents: 1\/3/);
  assert.match(dashboard, /Max turns: 20/);
  assert.match(dashboard, /HOW-2\s+In Progress/);
});

test("dashboard watch can render a single snapshot", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "lwo-dashboard-watch-"));
  const workflowPath = join(tempDir, "WORKFLOW.md");
  const originalLog = console.log;
  const lines = [];

  writeFileSync(workflowPath, buildWorkflow("Build a Linear-managed Codex plugin", true));
  console.log = (line) => lines.push(line);

  try {
    await run(["dashboard", workflowPath, "--watch", "--once", "--no-clear"]);
  } finally {
    console.log = originalLog;
    rmSync(tempDir, { recursive: true, force: true });
  }

  assert.match(lines.join("\n"), /SYMPHONY STATUS/);
});

test("run and tui commands render dashboard and perform one poll tick", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "lwo-run-once-"));
  const workflowPath = join(tempDir, "WORKFLOW.md");
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.LINEAR_API_KEY;
  const originalLog = console.log;
  const originalError = console.error;
  const lines = [];

  writeFileSync(workflowPath, [
    "---",
    "tracker:",
    "  kind: linear",
    "  project_slug: abc123",
    "polling:",
    "  interval_ms: 5000",
    "---",
    "# Workflow: Operator run",
    "",
    "## Execution Plan",
    "",
    "| ID | Title | Lane | Depends On | Status | Linear Issue | Branch/Worktree | Acceptance Criteria |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    "| LWO-001 | Build queue runner | serial | - | Todo | HOW-1 | - | Runner ticks once. |",
  ].join("\n"));

  process.env.LINEAR_API_KEY = "lin_api_test";
  console.log = (line) => lines.push(line);
  console.error = (line) => lines.push(line);
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    if (body.query.includes("ProjectIssues")) {
      assert.equal(body.variables.first, 10);
      assert.deepEqual(body.variables.states, ["Todo", "In Progress", "Merging", "Rework"]);
      return new Response(JSON.stringify({ data: { projects: { nodes: [] } } }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    throw new Error(`Unexpected query: ${body.query}`);
  };

  try {
    await run(["tui", workflowPath, "--once", "--no-clear"]);
  } finally {
    globalThis.fetch = originalFetch;
    console.log = originalLog;
    console.error = originalError;
    if (originalApiKey === undefined) delete process.env.LINEAR_API_KEY;
    else process.env.LINEAR_API_KEY = originalApiKey;
    rmSync(tempDir, { recursive: true, force: true });
  }

  const output = lines.join("\n");
  assert.match(output, /SYMPHONY STATUS/);
  assert.match(output, /"dispatched": 0/);
});

test("run defaults to statusline when invoked without args", async () => {
  const originalLog = console.log;
  const lines = [];
  console.log = (line) => lines.push(line);
  try {
    await run([]);
  } finally {
    console.log = originalLog;
  }

  assert.match(lines[0], /^Linear[: ]/);
});

test("statusline reports no active workflow when all issues are done", () => {
  let workflow = buildWorkflow("Build a Linear-managed Codex plugin", true);
  for (const issue of parseWorkflow(workflow)) {
    workflow = updateWorkflowStatus(workflow, issue.key, "Done");
  }

  assert.equal(formatStatusLine(currentIssue(parseWorkflow(workflow))), "Linear: no active workflow");
});

test("sync-linear apply queries workflow states with Linear ID team variable", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "lwo-"));
  const workflowPath = join(tempDir, "workflow.md");
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.LINEAR_API_KEY;
  const originalTeamId = process.env.LINEAR_TEAM_ID;
  const originalProjectUrl = process.env.LINEAR_PROJECT_URL;
  const originalLog = console.log;
  const queries = [];

  writeFileSync(workflowPath, executableWorkflow());
  process.env.LINEAR_API_KEY = "lin_api_test";
  process.env.LINEAR_TEAM_ID = "team-123";
  process.env.LINEAR_PROJECT_URL = "https://linear.app/acme/project/example-project-abcdef123456/issues";
  console.log = () => {};
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    queries.push(body.query);

    if (body.query.includes("WorkflowStates")) {
      return new Response(
        JSON.stringify({ data: { workflowStates: { nodes: [{ id: "state-123", name: "Backlog" }] } } }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    if (body.query.includes("Projects")) {
      return new Response(
        JSON.stringify({
          data: {
            team: {
              projects: {
                nodes: [
                  {
                    id: "project-123",
                    name: "Example Project",
                    slugId: "abcdef123456",
                    url: "https://linear.app/acme/project/example-project-abcdef123456",
                  },
                ],
              },
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    if (body.query.includes("IssueCreate")) {
      assert.equal(body.variables.input.projectId, "project-123");
      return new Response(
        JSON.stringify({
          data: {
            issueCreate: {
              success: true,
              issue: { identifier: "LWO-123", url: "https://linear.app/acme/issue/LWO-123/test" },
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    throw new Error(`Unexpected query: ${body.query}`);
  };

  try {
    await run(["sync-linear", workflowPath, "--apply"]);
  } finally {
    globalThis.fetch = originalFetch;
    console.log = originalLog;
    if (originalApiKey === undefined) delete process.env.LINEAR_API_KEY;
    else process.env.LINEAR_API_KEY = originalApiKey;
    if (originalTeamId === undefined) delete process.env.LINEAR_TEAM_ID;
    else process.env.LINEAR_TEAM_ID = originalTeamId;
    if (originalProjectUrl === undefined) delete process.env.LINEAR_PROJECT_URL;
    else process.env.LINEAR_PROJECT_URL = originalProjectUrl;
    rmSync(tempDir, { recursive: true, force: true });
  }

  assert.ok(queries.some((query) => /query WorkflowStates\(\$teamId: ID!\)/.test(query)));
  assert.ok(queries.some((query) => /query Projects\(\$teamId: String!\)/.test(query)));
});

test("sync-linear apply resolves team and creates project from api key only", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "lwo-auto-linear-"));
  const workflowPath = join(tempDir, "workflow.md");
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.LINEAR_API_KEY;
  const originalTeamId = process.env.LINEAR_TEAM_ID;
  const originalProjectUrl = process.env.LINEAR_PROJECT_URL;
  const originalLog = console.log;
  const queries = [];

  writeFileSync(workflowPath, executableWorkflow("Build bookmark CLI"));
  process.env.LINEAR_API_KEY = "lin_api_test";
  delete process.env.LINEAR_TEAM_ID;
  delete process.env.LINEAR_PROJECT_URL;
  console.log = () => {};
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    queries.push(body.query);

    if (body.query.includes("query Teams")) {
      return new Response(
        JSON.stringify({ data: { teams: { nodes: [{ id: "team-auto", name: "Engineering", key: "ENG" }] } } }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (body.query.includes("ProjectCreate")) {
      assert.equal(body.variables.input.teamIds[0], "team-auto");
      return new Response(
        JSON.stringify({ data: { projectCreate: { success: true, project: { id: "project-auto", name: "Build bookmark CLI", url: "https://linear.app/acme/project/build-bookmark-cli-abc123", slugId: "abc123" } } } }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (body.query.includes("WorkflowStates")) {
      assert.equal(body.variables.teamId, "team-auto");
      return new Response(
        JSON.stringify({ data: { workflowStates: { nodes: [{ id: "state-backlog", name: "Backlog" }] } } }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (body.query.includes("IssueCreate")) {
      assert.equal(body.variables.input.teamId, "team-auto");
      assert.equal(body.variables.input.projectId, "project-auto");
      return new Response(
        JSON.stringify({ data: { issueCreate: { success: true, issue: { identifier: "ENG-1", url: "https://linear.app/acme/issue/ENG-1/test" } } } }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    throw new Error(`Unexpected query: ${body.query}`);
  };

  try {
    await run(["sync-linear", workflowPath, "--apply"]);
  } finally {
    globalThis.fetch = originalFetch;
    console.log = originalLog;
    if (originalApiKey === undefined) delete process.env.LINEAR_API_KEY;
    else process.env.LINEAR_API_KEY = originalApiKey;
    if (originalTeamId === undefined) delete process.env.LINEAR_TEAM_ID;
    else process.env.LINEAR_TEAM_ID = originalTeamId;
    if (originalProjectUrl === undefined) delete process.env.LINEAR_PROJECT_URL;
    else process.env.LINEAR_PROJECT_URL = originalProjectUrl;
    rmSync(tempDir, { recursive: true, force: true });
  }

  assert.ok(queries.some((query) => query.includes("query Teams")));
  assert.ok(queries.some((query) => query.includes("ProjectCreate")));
});

test("poll dispatches Linear Todo issue into workspace without prompting", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "lwo-poll-"));
  const workflowPath = join(tempDir, "WORKFLOW.md");
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.LINEAR_API_KEY;
  const originalProjectUrl = process.env.LINEAR_PROJECT_URL;
  const queries = [];

  writeFileSync(workflowPath, [
    "---",
    "tracker:",
    "  kind: linear",
    "  project_slug: abc123",
    "  active_states:",
    "    - Todo",
    "    - In Progress",
    "polling:",
    "  interval_ms: 5000",
    "workspace:",
    `  root: ${join(tempDir, "workspaces")}`,
    "agent:",
    "  max_concurrent_agents: 1",
    "  max_turns: 2",
    "codex:",
    "  command: echo \"$SYMPHONY_ISSUE_IDENTIFIER\" > agent-ran.txt",
    "---",
    "You are working on {{ issue.identifier }}: {{ issue.title }}",
  ].join("\n"));

  process.env.LINEAR_API_KEY = "lin_api_test";
  delete process.env.LINEAR_PROJECT_URL;
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    queries.push(body.query);

    if (body.query.includes("ProjectIssues")) {
      assert.match(body.query, /issues\(\s*first: \$first/);
      assert.match(body.query, /state: \{ name: \{ in: \$states \} \}/);
      assert.equal(body.variables.first, 10);
      assert.deepEqual(body.variables.states, ["Todo", "In Progress"]);
      return new Response(
        JSON.stringify({
          data: {
            projects: {
              nodes: [{
                id: "project-1",
                issues: {
                  nodes: [{
                    id: "issue-id-1",
                    identifier: "HOW-1",
                    title: "Build bookmark CLI",
                    description: "Acceptance from Linear",
                    priority: 1,
                    url: "https://linear.app/acme/issue/HOW-1/test",
                    createdAt: "2026-05-07T00:00:00.000Z",
                    updatedAt: "2026-05-07T00:00:00.000Z",
                    state: { name: "Todo" },
                    team: { id: "team-1", name: "Engineering", key: "ENG" },
                    labels: { nodes: [{ name: "symphony" }] },
                  }],
                },
              }],
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (body.query.includes("WorkflowStates")) {
      return new Response(
        JSON.stringify({ data: { workflowStates: { nodes: [{ id: "state-progress", name: "In Progress" }] } } }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (body.query.includes("IssueUpdate")) {
      return new Response(
        JSON.stringify({ data: { issueUpdate: { success: true, issue: { identifier: "HOW-1", state: { name: "In Progress" } } } } }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (body.query.includes("IssueComments")) {
      return new Response(
        JSON.stringify({ data: { issue: { comments: { nodes: [] } } } }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (body.query.includes("CommentCreate")) {
      assert.match(body.variables.input.body, /## Codex Workpad/);
      return new Response(
        JSON.stringify({ data: { commentCreate: { success: true, comment: { id: "comment-1", body: body.variables.input.body } } } }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    throw new Error(`Unexpected query: ${body.query}`);
  };

  try {
    const result = await pollLinearOnce(workflowPath);
    assert.equal(result.dispatched, 1);
    assert.equal(readFileSync(join(tempDir, "workspaces", "HOW-1", "agent-ran.txt"), "utf8").trim(), "HOW-1");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.LINEAR_API_KEY;
    else process.env.LINEAR_API_KEY = originalApiKey;
    if (originalProjectUrl === undefined) delete process.env.LINEAR_PROJECT_URL;
    else process.env.LINEAR_PROJECT_URL = originalProjectUrl;
    rmSync(tempDir, { recursive: true, force: true });
  }

  assert.ok(queries.some((query) => query.includes("ProjectIssues")));
  assert.ok(queries.some((query) => query.includes("CommentCreate")));
});

test("goal command creates workflow, applies Linear, promotes ready issue, and polls", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "lwo-goal-"));
  const workflowPath = join(tempDir, "WORKFLOW.md");
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.LINEAR_API_KEY;
  const originalTeamId = process.env.LINEAR_TEAM_ID;
  const originalProjectUrl = process.env.LINEAR_PROJECT_URL;
  const originalLog = console.log;
  const lines = [];
  let issueCreateIndex = 0;
  let workflowAfter = "";

  process.env.LINEAR_API_KEY = "lin_api_test";
  delete process.env.LINEAR_TEAM_ID;
  delete process.env.LINEAR_PROJECT_URL;
  console.log = (line) => lines.push(line);
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    if (body.query.includes("query Teams")) {
      return new Response(JSON.stringify({ data: { teams: { nodes: [{ id: "team-1", name: "Engineering", key: "ENG" }] } } }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (body.query.includes("ProjectCreate")) {
      return new Response(JSON.stringify({ data: { projectCreate: { success: true, project: { id: "project-1", name: "Goal", url: "https://linear.app/acme/project/goal-abc123", slugId: "abc123" } } } }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (body.query.includes("WorkflowStates")) {
      return new Response(JSON.stringify({ data: { workflowStates: { nodes: [{ id: "state-backlog", name: "Backlog" }, { id: "state-todo", name: "Todo" }, { id: "state-progress", name: "In Progress" }] } } }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (body.query.includes("IssueCreate")) {
      issueCreateIndex += 1;
      return new Response(JSON.stringify({ data: { issueCreate: { success: true, issue: { id: `issue-${issueCreateIndex}`, identifier: `ENG-${issueCreateIndex}`, title: body.variables.input.title, url: `https://linear.app/acme/issue/ENG-${issueCreateIndex}` } } } }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (body.query.includes("IssueUpdate")) {
      return new Response(JSON.stringify({ data: { issueUpdate: { success: true, issue: { identifier: body.variables.id, state: { name: "Todo" } } } } }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (body.query.includes("ProjectIssues")) {
      assert.equal(body.variables.first, 10);
      return new Response(JSON.stringify({ data: { projects: { nodes: [] } } }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    throw new Error(`Unexpected query: ${body.query}`);
  };

  try {
    await run(["goal", "Build bookmark CLI", "--out", workflowPath, "--apply", "--poll", "--dry-run-agent", "--skip-hooks"]);
    workflowAfter = readFileSync(workflowPath, "utf8");
  } finally {
    globalThis.fetch = originalFetch;
    console.log = originalLog;
    if (originalApiKey === undefined) delete process.env.LINEAR_API_KEY;
    else process.env.LINEAR_API_KEY = originalApiKey;
    if (originalTeamId === undefined) delete process.env.LINEAR_TEAM_ID;
    else process.env.LINEAR_TEAM_ID = originalTeamId;
    if (originalProjectUrl === undefined) delete process.env.LINEAR_PROJECT_URL;
    else process.env.LINEAR_PROJECT_URL = originalProjectUrl;
    rmSync(tempDir, { recursive: true, force: true });
  }

  const result = JSON.parse(lines.at(-1));
  assert.equal(result.linear.applied, true);
  assert.equal(result.promoted.length, 1);
  assert.match(workflowAfter, /project_slug: "abc123"/);
});

test("start-issue marks a ready issue in progress and assigns a branch without checkout", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "lwo-start-"));
  const workflowPath = join(tempDir, "workflow.md");
  const originalLog = console.log;
  const lines = [];

  writeFileSync(workflowPath, executableWorkflow());
  console.log = (line) => lines.push(line);

  try {
    await run(["select-issue", workflowPath, "LWO-001"]);
    await run(["start-issue", workflowPath, "LWO-001", "--mode", "github"]);
  } finally {
    console.log = originalLog;
    rmSync(tempDir, { recursive: true, force: true });
  }

  const result = JSON.parse(lines[1]);
  assert.equal(result.branch, "issue/how-1-define-implementation-contract-for-build-a-linea");
});

test("start-issue apply-linear creates a Linear workpad comment", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "lwo-workpad-start-"));
  const workflowPath = join(tempDir, "workflow.md");
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.LINEAR_API_KEY;
  const originalTeamId = process.env.LINEAR_TEAM_ID;
  const originalLog = console.log;
  const queries = [];
  const lines = [];

  writeFileSync(workflowPath, executableWorkflow());
  process.env.LINEAR_API_KEY = "lin_api_test";
  process.env.LINEAR_TEAM_ID = "team-123";
  console.log = (line) => lines.push(line);
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    queries.push(body.query);

    if (body.query.includes("WorkflowStates")) {
      return new Response(
        JSON.stringify({ data: { workflowStates: { nodes: [{ id: "state-in-progress", name: "In Progress" }] } } }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (body.query.includes("IssueUpdate")) {
      return new Response(
        JSON.stringify({ data: { issueUpdate: { success: true, issue: { identifier: "HOW-1", state: { name: "In Progress" } } } } }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (body.query.includes("IssueComments")) {
      return new Response(
        JSON.stringify({ data: { issue: { comments: { nodes: [] } } } }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (body.query.includes("CommentCreate")) {
      assert.match(body.variables.input.body, /## Codex Workpad/);
      assert.match(body.variables.input.body, /Started active work/);
      return new Response(
        JSON.stringify({ data: { commentCreate: { success: true, comment: { id: "comment-1", body: body.variables.input.body } } } }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    throw new Error(`Unexpected query: ${body.query}`);
  };

  try {
    await run(["select-issue", workflowPath, "LWO-001"]);
    await run(["start-issue", workflowPath, "LWO-001", "--mode", "github", "--apply-linear"]);
  } finally {
    globalThis.fetch = originalFetch;
    console.log = originalLog;
    if (originalApiKey === undefined) delete process.env.LINEAR_API_KEY;
    else process.env.LINEAR_API_KEY = originalApiKey;
    if (originalTeamId === undefined) delete process.env.LINEAR_TEAM_ID;
    else process.env.LINEAR_TEAM_ID = originalTeamId;
    rmSync(tempDir, { recursive: true, force: true });
  }

  const result = JSON.parse(lines[1]);
  assert.equal(result.workpad.action, "created");
  assert.ok(queries.some((query) => query.includes("CommentCreate")));
});

test("start-issue checkout creates an issue branch before writing workflow changes", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "lwo-git-start-"));
  const originalCwd = process.cwd();
  const originalLog = console.log;
  const lines = [];

  try {
    process.chdir(tempDir);
    execFileSync("git", ["init", "-b", "main"], { stdio: "ignore" });
    execFileSync("git", ["config", "user.email", "test@example.com"]);
    execFileSync("git", ["config", "user.name", "Test User"]);
    writeFileSync("workflow.md", executableWorkflow());
    execFileSync("git", ["add", "workflow.md"]);
    execFileSync("git", ["commit", "-m", "Initial workflow"], { stdio: "ignore" });
    console.log = (line) => lines.push(line);

    await run(["select-issue", "workflow.md", "LWO-001"]);
    await run(["start-issue", "workflow.md", "LWO-001", "--mode", "github", "--checkout"]);

    const currentBranch = execFileSync("git", ["branch", "--show-current"], { encoding: "utf8" }).trim();
    const issue = parseWorkflow(readFileSync("workflow.md", "utf8")).find((item) => item.key === "LWO-001");
    assert.equal(currentBranch, "issue/how-1-define-implementation-contract-for-build-a-linea");
    assert.equal(issue.status, "In Progress");
    assert.equal(issue.branch, currentBranch);
  } finally {
    console.log = originalLog;
    process.chdir(originalCwd);
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("select-issue refuses execution before Linear backlog registration unless local-only", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "lwo-linear-required-"));
  const workflowPath = join(tempDir, "workflow.md");
  writeFileSync(
    workflowPath,
    updateStartupAnswers(buildWorkflow("Build a Linear-managed Codex plugin", false), {
      workspace: "github",
      credentials: "exported",
      goalMode: "off",
    }),
  );

  try {
    await assert.rejects(() => run(["select-issue", workflowPath, "LWO-001"]), /must have a Linear issue identifier/);
    await run(["select-issue", workflowPath, "LWO-001", "--local-only"]);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("set-status enforces review gate before merging", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "lwo-review-gate-"));
  const workflowPath = join(tempDir, "workflow.md");
  writeFileSync(workflowPath, executableWorkflow());

  try {
    await assert.rejects(() => run(["set-status", workflowPath, "LWO-001", "Merging"]), /invalid status transition/);
    await run(["select-issue", workflowPath, "LWO-001"]);
    await run(["start-issue", workflowPath, "LWO-001", "--mode", "github"]);
    await run(["set-status", workflowPath, "LWO-001", "Review"]);
    await assert.rejects(() => run(["set-status", workflowPath, "LWO-001", "Merging"]), /--reviewed-by is required/);
    await run(["set-status", workflowPath, "LWO-001", "Merging", "--reviewed-by", "codex-reviewer"]);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("worktree checkout updates root workflow and mirrors into the worktree", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "lwo-worktree-start-"));
  const worktreeDir = join(tmpdir(), `lwo-worktree-${crypto.randomUUID()}`);
  const originalCwd = process.cwd();
  const originalLog = console.log;
  console.log = () => {};

  try {
    process.chdir(tempDir);
    execFileSync("git", ["init", "-b", "main"], { stdio: "ignore" });
    execFileSync("git", ["config", "user.email", "test@example.com"]);
    execFileSync("git", ["config", "user.name", "Test User"]);
    writeFileSync("workflow.md", executableWorkflow());
    execFileSync("git", ["add", "workflow.md"]);
    execFileSync("git", ["commit", "-m", "Initial workflow"], { stdio: "ignore" });

    await run(["select-issue", "workflow.md", "LWO-001"]);
    await run(["start-issue", "workflow.md", "LWO-001", "--mode", "worktree", "--worktree-dir", worktreeDir, "--checkout"]);

    const rootIssue = parseWorkflow(readFileSync("workflow.md", "utf8")).find((item) => item.key === "LWO-001");
    const worktreeIssue = parseWorkflow(readFileSync(join(worktreeDir, "workflow.md"), "utf8")).find((item) => item.key === "LWO-001");
    assert.equal(rootIssue.status, "In Progress");
    assert.equal(worktreeIssue.status, "In Progress");
    assert.equal(rootIssue.branch, worktreeDir);
  } finally {
    console.log = originalLog;
    process.chdir(originalCwd);
    rmSync(worktreeDir, { recursive: true, force: true });
    rmSync(tempDir, { recursive: true, force: true });
  }
});
