// Copyright (C) 2014-2026 Laurier Sylph. All rights reserved.
import * as vscode from "vscode";
import { instructionPath, updateInstructionConfig } from "./instructionConfig.js";

let configuring = false;

export async function configureInstructions(): Promise<void> {
  if (configuring) return;
  configuring = true;
  try {
    await configure();
  } catch (error) {
    await vscode.window.showErrorMessage(error instanceof Error ? error.message : "Could not configure instruction files.");
  } finally {
    configuring = false;
  }
}

async function exists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch (error) {
    if (error instanceof vscode.FileSystemError && error.code === "FileNotFound") return false;
    throw error;
  }
}

async function assertRegularFile(root: vscode.Uri, file: vscode.Uri): Promise<string> {
  if (file.scheme !== root.scheme || file.authority !== root.authority) {
    throw new Error("Choose a file inside the workspace root.");
  }
  const relative = instructionPath(root.path, file.path);
  let current = root;
  const segments = relative.slice(2).split("/");
  for (const [index, segment] of segments.entries()) {
    current = vscode.Uri.joinPath(current, segment);
    const stat = await vscode.workspace.fs.stat(current);
    if (stat.type & vscode.FileType.SymbolicLink) throw new Error("Symbolic links are not supported here. Choose a regular workspace file.");
    const expected = index === segments.length - 1 ? vscode.FileType.File : vscode.FileType.Directory;
    if (!(stat.type & expected)) throw new Error("Choose an existing regular workspace file.");
  }
  return relative;
}

async function assertConfigLayout(root: vscode.Uri): Promise<void> {
  for (const name of ["opencode.jsonc", ".opencode/opencode.json", ".opencode/opencode.jsonc", ".opencode/agents/build.md"]) {
    if (await exists(vscode.Uri.joinPath(root, name))) {
      throw new Error(`Found ${name}. To avoid JSONC damage or configuration precedence conflicts, edit the existing OpenCode configuration manually. Use instructions: ["./file.md"] for additions or agents.build.system: "{file:./file.md}" for replacement. This command only updates a single root opencode.json.`);
    }
  }
}

async function configure(): Promise<void> {
  const folders = vscode.workspace.workspaceFolders;
  if (folders?.length !== 1) throw new Error("Open exactly one workspace folder before configuring OpenCode instruction files.");
  const root = folders[0]!.uri;
  const configUri = vscode.Uri.joinPath(root, "opencode.json");
  const choice = await vscode.window.showQuickPick([
    { label: "Add Instructions", description: "Add files alongside AGENTS.md; preserve existing instructions", action: "instructions" as const },
    { label: "Set Build System Prompt", description: "Replace Build's base system prompt; project instructions still apply", action: "system" as const },
    { label: "View Config", description: "Open workspace opencode.json or opencode.jsonc", action: "view" as const },
  ], { title: "OpenCode Workspace Instructions", placeHolder: "Native OpenCode v2 startup configuration" });
  if (!choice) return;
  if (choice.action === "view") {
    const targets = [];
    for (const name of ["opencode.json", "opencode.jsonc", ".opencode/opencode.json", ".opencode/opencode.jsonc"]) {
      const uri = vscode.Uri.joinPath(root, name);
      if (await exists(uri)) targets.push({ label: name, uri });
    }
    if (!targets.length) throw new Error("No workspace OpenCode config exists. Use Add Instructions or Set Build System Prompt to create opencode.json.");
    const target = targets.length === 1 ? targets[0] : await vscode.window.showQuickPick(targets);
    if (target) await vscode.window.showTextDocument(target.uri);
    return;
  }
  if (!vscode.workspace.isTrusted) throw new Error("Trust this workspace before writing OpenCode configuration.");
  await assertConfigLayout(root);
  const present = await exists(configUri);
  if (present) await assertRegularFile(root, configUri);
  const document = present ? await vscode.workspace.openTextDocument(configUri) : undefined;
  if (document?.isDirty) throw new Error("Save or discard pending opencode.json edits before running this command.");
  const source = document?.getText() ?? '{}';
  const version = document?.version;
  const files = await vscode.window.showOpenDialog({
    defaultUri: root,
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: choice.action === "instructions",
    title: choice.action === "instructions" ? "Choose additional instruction files" : "Choose Build base system prompt file",
  });
  if (!files?.length) return;
  const paths = [];
  for (const file of files) paths.push(await assertRegularFile(root, file));
  const updated = updateInstructionConfig(source, choice.action, paths);
  const message = choice.action === "instructions"
    ? `Add ${paths.join(", ")} to workspace instructions? Existing entries and AGENTS.md remain in use.`
    : `Use ${paths[0]} as Build's base system prompt? This replaces the default or previously configured base prompt. Project instructions still apply.`;
  if (await vscode.window.showWarningMessage(message, { modal: true }, "Save Configuration") !== "Save Configuration") return;
  if (!vscode.workspace.isTrusted || vscode.workspace.workspaceFolders?.length !== 1 || vscode.workspace.workspaceFolders[0]?.uri.toString() !== root.toString()) {
    throw new Error("Workspace or trust changed. Run the command again.");
  }
  await assertConfigLayout(root);
  for (const file of files) await assertRegularFile(root, file);
  if (present) {
    await assertRegularFile(root, configUri);
    const disk = new TextDecoder().decode(await vscode.workspace.fs.readFile(configUri));
    if (document?.isDirty || document?.version !== version || disk !== source) throw new Error("opencode.json changed during configuration. Run the command again.");
  } else if (await exists(configUri)) {
    throw new Error("opencode.json was created during configuration. Run the command again.");
  }
  const edit = new vscode.WorkspaceEdit();
  if (document) {
    edit.replace(configUri, new vscode.Range(document.positionAt(0), document.positionAt(source.length)), updated);
  } else {
    edit.createFile(configUri, { overwrite: false });
    edit.insert(configUri, new vscode.Position(0, 0), updated);
  }
  if (!await vscode.workspace.applyEdit(edit)) throw new Error("Could not apply configuration edits. Check opencode.json in the editor.");
  const saved = await vscode.workspace.openTextDocument(configUri);
  if (!await saved.save()) throw new Error("Configuration edits are unsaved. Save opencode.json in the editor before restarting OpenCode.");
  await vscode.window.showInformationMessage("Saved workspace opencode.json. After active work finishes, restart the OpenCode server, reconnect Studio, and start a new session to use the configuration. Reconnecting alone may reuse cached configuration. Parent, global, managed, or agent-file settings may override it; hot reload is not guaranteed.");
}
