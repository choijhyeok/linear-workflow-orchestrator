#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);
const pluginRoot = path.join(repoRoot, "plugins", "linear-workflow-orchestrator");
const skillRoot = path.join(pluginRoot, "skills", "linear-workflow-orchestrator");
const sourceSkillPath = path.join(skillRoot, "SKILL.md");
const installedSkillRoot = path.join(os.homedir(), ".codex", "skills", "linear-workflow-orchestrator");
const installedSkillPath = path.join(installedSkillRoot, "SKILL.md");
const installedBinRoot = path.join(os.homedir(), ".codex", "bin");
const statuslineWrapperPath = path.join(installedBinRoot, "linear-workflow-orchestrator-statusline");
const dashboardWrapperPath = path.join(installedBinRoot, "linear-workflow-orchestrator-dashboard");
const helperPath = path.join(pluginRoot, "scripts", "linear-workflow-orchestrator.mjs");
const configPath = path.join(os.homedir(), ".codex", "config.json");
const tomlPath = path.join(os.homedir(), ".codex", "config.toml");

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return {};
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function unique(values) {
  return [...new Set(values)];
}

fs.mkdirSync(path.dirname(configPath), { recursive: true });
const config = readJson(configPath);

const plugin = {
  name: "linear-workflow-orchestrator",
  marketplace: "linear-workflow-orchestrator-marketplace",
  version: "0.1.0",
  installed_at: new Date().toISOString(),
  enabled: true,
  cache_path: pluginRoot,
  source: {
    source: "local",
    path: pluginRoot,
  },
};

config.installedPlugins = (config.installedPlugins || []).filter((entry) => entry.name !== plugin.name);
config.installedPlugins.push(plugin);

// Codex CLI 0.128 can register a local marketplace without automatically exposing
// its skills to exec sessions. Keep the explicit skill directory until plugin
// install APIs expose local plugin skills directly.
config.skillDirectories = unique(
  (config.skillDirectories || [])
    .filter((entry) => !entry.startsWith(path.join(pluginRoot, "skills")))
    .concat(skillRoot),
);

config.statusLineCommands = {
  ...(config.statusLineCommands || {}),
  "linear-workflow-orchestrator": {
    command: statuslineWrapperPath,
    description: "Show the active Linear workflow issue from workflow.md with terminal hyperlinks when supported.",
    source: plugin.name,
  },
  "linear-workflow-orchestrator-dashboard": {
    command: dashboardWrapperPath,
    description: "Show a Symphony-lite multiline dashboard for workflow.md when the host supports command-backed HUD panels.",
    source: plugin.name,
  },
};

fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);

fs.mkdirSync(installedSkillRoot, { recursive: true });
const sourceSkill = fs.readFileSync(sourceSkillPath, "utf8");
const installedSkill = sourceSkill.replaceAll(
  "node plugins/linear-workflow-orchestrator/scripts/linear-workflow-orchestrator.mjs",
  `node ${helperPath}`,
);
fs.writeFileSync(installedSkillPath, installedSkill);

fs.mkdirSync(installedBinRoot, { recursive: true });
const statuslineWrapper = [
  "#!/bin/sh",
  "set -eu",
  'if [ "$#" -eq 0 ]; then',
  "  set -- workflow.md",
  "fi",
  `exec node "${helperPath.replace(/"/g, '\\"')}" statusline "$@" --hyperlink`,
  "",
].join("\n");
fs.writeFileSync(statuslineWrapperPath, statuslineWrapper, { mode: 0o755 });
fs.chmodSync(statuslineWrapperPath, 0o755);
const dashboardWrapper = [
  "#!/bin/sh",
  "set -eu",
  'if [ "$#" -eq 0 ]; then',
  "  set -- workflow.md",
  "fi",
  `exec node "${helperPath.replace(/"/g, '\\"')}" dashboard "$@"`,
  "",
].join("\n");
fs.writeFileSync(dashboardWrapperPath, dashboardWrapper, { mode: 0o755 });
fs.chmodSync(dashboardWrapperPath, 0o755);

function upsertTomlSkillDirectory(filePath, directory) {
  const escaped = directory.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const value = `"${escaped}"`;
  let toml = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
  const lines = toml.split("\n");
  const existingValues = [];
  const keptLines = [];

  for (const line of lines) {
    const match = line.match(/^skill_directories\s*=\s*\[(.*?)\]\s*$/);
    if (match) {
      for (const item of match[1].split(",")) {
        const trimmed = item.trim();
        if (trimmed) existingValues.push(trimmed);
      }
    } else {
      keptLines.push(line);
    }
  }

  const items = unique([...existingValues, value]);
  const topLevelLine = `skill_directories = [${items.join(", ")}]`;
  const firstTableIndex = keptLines.findIndex((line) => line.trim().startsWith("["));
  if (firstTableIndex === -1) {
    keptLines.push(topLevelLine);
  } else {
    keptLines.splice(firstTableIndex, 0, topLevelLine, "");
  }
  fs.writeFileSync(filePath, `${keptLines.join("\n").replace(/\n+$/, "")}\n`);
}

upsertTomlSkillDirectory(tomlPath, skillRoot);

function tomlString(value) {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function upsertTomlPluginStatusLine(filePath, commandPath) {
  let toml = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
  const table = '[plugins."linear-workflow-orchestrator@linear-workflow-orchestrator-marketplace".statusline]';
  const block = [
    table,
    'type = "command"',
    `command = ${tomlString(commandPath)}`,
    'hyperlink = true',
  ].join("\n");
  const pattern = new RegExp(`\\n?\\[plugins\\."linear-workflow-orchestrator@linear-workflow-orchestrator-marketplace"\\.statusline\\][\\s\\S]*?(?=\\n\\[|$)`);
  if (pattern.test(toml)) {
    toml = toml.replace(pattern, `\n${block}`);
  } else {
    toml = `${toml.replace(/\n+$/, "")}\n\n${block}\n`;
  }
  fs.writeFileSync(filePath, `${toml.replace(/\n+$/, "")}\n`);
}

function upsertTomlPluginDashboard(filePath, commandPath) {
  let toml = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
  const table = '[plugins."linear-workflow-orchestrator@linear-workflow-orchestrator-marketplace".dashboard]';
  const block = [
    table,
    'type = "command"',
    `command = ${tomlString(commandPath)}`,
    'multiline = true',
  ].join("\n");
  const pattern = new RegExp(`\\n?\\[plugins\\."linear-workflow-orchestrator@linear-workflow-orchestrator-marketplace"\\.dashboard\\][\\s\\S]*?(?=\\n\\[|$)`);
  if (pattern.test(toml)) {
    toml = toml.replace(pattern, `\n${block}`);
  } else {
    toml = `${toml.replace(/\n+$/, "")}\n\n${block}\n`;
  }
  fs.writeFileSync(filePath, `${toml.replace(/\n+$/, "")}\n`);
}

upsertTomlPluginStatusLine(tomlPath, statuslineWrapperPath);
upsertTomlPluginDashboard(tomlPath, dashboardWrapperPath);

console.log(`Installed local plugin metadata: ${plugin.name}@${plugin.marketplace}`);
console.log(`Registered skill directory: ${skillRoot}`);
console.log(`Installed skill: ${installedSkillPath}`);
console.log(`Installed statusline command: ${statuslineWrapperPath}`);
console.log(`Installed dashboard command: ${dashboardWrapperPath}`);
console.log(`Wrote ${configPath}`);
console.log(`Updated ${tomlPath}`);
console.log("Note: current Codex TUI builds do not execute arbitrary plugin HUD commands under the composer; use the dashboard wrapper in a side pane until the host supports it.");
