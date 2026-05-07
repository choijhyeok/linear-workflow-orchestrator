import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  authorizationHeader,
  buildIssueInputs,
  buildWorkflow,
  currentIssue,
  formatStatusLine,
  parseWorkflow,
  projectIdFromUrl,
  updateWorkflowLinearIssues,
  updateWorkflowStatus,
  run,
} from "../plugins/linear-workflow-orchestrator/scripts/linear-workflow-orchestrator.mjs";

test("build and parse workflow round trip", () => {
  const workflow = buildWorkflow("Build a Linear-managed Codex plugin", true);
  const issues = parseWorkflow(workflow);

  assert.equal(issues.length, 5);
  assert.equal(issues[0].key, "LWO-001");
  assert.equal(issues[0].status, "Backlog");
  assert.deepEqual(issues[1].dependsOn, ["LWO-001"]);
  assert.match(workflow, /Goal mode: on/);
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

test("update workflow status changes matching row", () => {
  const workflow = buildWorkflow("Build a Linear-managed Codex plugin", true);
  const updated = updateWorkflowStatus(workflow, "LWO-004", "In Progress", "ABC-123");
  const issue = parseWorkflow(updated).find((item) => item.key === "LWO-004");

  assert.equal(issue.status, "In Progress");
  assert.equal(issue.linearIssue, "ABC-123");
});

test("update workflow linear issues records created identifiers", () => {
  const workflow = buildWorkflow("Build a Linear-managed Codex plugin", true);
  const updated = updateWorkflowLinearIssues(workflow, new Map([["LWO-002", "LWO-200"]]));
  const issues = parseWorkflow(updated);

  assert.equal(issues.find((item) => item.key === "LWO-001").linearIssue, "");
  assert.equal(issues.find((item) => item.key === "LWO-002").linearIssue, "LWO-200");
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

test("run defaults to statusline when invoked without args", async () => {
  const originalLog = console.log;
  const lines = [];
  console.log = (line) => lines.push(line);
  try {
    await run([]);
  } finally {
    console.log = originalLog;
  }

  assert.match(lines[0], /^Linear /);
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

  writeFileSync(workflowPath, buildWorkflow("Build a Linear-managed Codex plugin", false));
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
