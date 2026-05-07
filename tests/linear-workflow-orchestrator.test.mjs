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
  formatStatusLine,
  linearIssueUrl,
  parseWorkflow,
  preflightQuestions,
  projectIdFromUrl,
  branchNameForIssue,
  parallelWave,
  readyIssues,
  updateStartupAnswers,
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
  const workflow = buildWorkflow("Build a Linear-managed Codex plugin", true);
  const issues = parseWorkflow(workflow);

  assert.equal(issues.length, 5);
  assert.equal(issues[0].key, "LWO-001");
  assert.equal(issues[0].status, "Backlog");
  assert.equal(issues[0].branch, "");
  assert.deepEqual(issues[1].dependsOn, ["LWO-001"]);
  assert.match(workflow, /Goal mode: on/);
  assert.match(workflow, /Branch\/Worktree/);
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

  assert.deepEqual(questions.map((question) => question.id), ["execution_workspace", "linear_credentials", "goal_mode"]);
  assert.equal(questions[1].options[0], "exported");
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

test("ready issues only include dependency-satisfied backlog or todo work", () => {
  let workflow = buildWorkflow("Build a Linear-managed Codex plugin", true);
  let issues = readyIssues(parseWorkflow(workflow));
  assert.deepEqual(issues.map((issue) => issue.key), ["LWO-001"]);

  workflow = updateWorkflowStatus(workflow, "LWO-001", "Done");
  issues = readyIssues(parseWorkflow(workflow));
  assert.deepEqual(issues.map((issue) => issue.key), ["LWO-002"]);
});

test("parallel wave only includes dependency-ready parallel work", () => {
  let workflow = buildWorkflow("Build a Linear-managed Codex plugin", true);
  workflow = updateWorkflowStatus(workflow, "LWO-001", "Done");
  workflow = updateWorkflowStatus(workflow, "LWO-002", "Done");
  workflow = updateWorkflowStatus(workflow, "LWO-003", "Done");
  const wave = parallelWave(parseWorkflow(workflow));

  assert.deepEqual(wave.map((issue) => issue.key), ["LWO-004"]);
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

  assert.equal(line, "Linear In Progress: LWO-004 Execute independent implementation lanes · ABC-123");
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

  assert.match(queries[0], /query WorkflowStates\(\$teamId: ID!\)/);
  assert.match(queries[1], /query Projects\(\$teamId: String!\)/);
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
  assert.equal(result.branch, "issue/how-1-clarify-workflow-scope-and-authority");
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
    assert.equal(currentBranch, "issue/how-1-clarify-workflow-scope-and-authority");
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
