// Copyright (C) 2014-2026 Laurier Sylph. All rights reserved.
import * as vscode from "vscode";
import path from "node:path";
import { readSettings } from "../config/settings.js";
import { isWebviewMessage, type HostToWebview } from "../shared/protocol.js";
import type { StudioController } from "../state/controller.js";

export class StudioView {
  private panel: vscode.WebviewPanel | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly controller: StudioController,
  ) {}

  resolveSidebar(webviewView: vscode.WebviewView): void {
    const subscription = this.bind(webviewView.webview, "sidebar");
    webviewView.onDidDispose(() => subscription.dispose());
  }

  openPanel(): void {
    if (this.panel) {
      this.panel.reveal();
      return;
    }
    this.panel = vscode.window.createWebviewPanel(
      "opencodeStudio.panel",
      "OpenCode Studio",
      vscode.ViewColumn.Beside,
      this.options(),
    );
    const subscription = this.bind(this.panel.webview, "panel");
    this.panel.onDidDispose(() => {
      subscription.dispose();
      this.panel = undefined;
    });
  }

  private bind(webview: vscode.Webview, surface: "sidebar" | "panel"): vscode.Disposable {
    webview.options = this.options();
    webview.html = this.html(webview, surface);
    const subscription = this.controller.subscribe((snapshot) => {
      this.post(webview, { type: "snapshot", snapshot });
    });
    webview.onDidReceiveMessage(async (message: unknown) => {
      if (!isWebviewMessage(message)) return;
      try {
        await this.handle(message);
      } catch (error) {
        const text = error instanceof Error ? error.message : "操作に失敗しました";
        this.post(webview, { type: "error", message: text });
      }
    });
    return subscription;
  }

  private async handle(message: ReturnType<typeof asMessage>): Promise<void> {
    switch (message.type) {
      case "ready":
        if (readSettings().autoConnect && this.controller.snapshot().phase === "disconnected") {
          await this.controller.connect();
        }
        return;
      case "connect":
        await this.controller.connect();
        return;
      case "disconnect":
        await this.controller.disconnect();
        return;
      case "newSession":
        await this.controller.newSession();
        return;
      case "selectSession":
        await this.controller.selectSession(message.sessionID);
        return;
      case "renameSession":
        await this.controller.renameSession(message.sessionID, message.title);
        return;
      case "deleteSession":
        await this.controller.deleteSession(message.sessionID);
        return;
      case "send":
        await this.controller.send(message.text);
        return;
      case "stop":
        await this.controller.stop();
        return;
      case "setModel":
        await this.controller.setModel(message.providerID, message.modelID, message.variant);
        return;
      case "setAgent":
        await this.controller.setAgent(message.agentID);
        return;
      case "setMode":
        await this.controller.setMode(message.mode);
        return;
      case "approve":
        await this.controller.approve(message.requestID, message.decision);
        return;
      case "openDiff":
        await openPatch(message.file, this.controller.snapshot());
        return;
      case "revert":
        await this.controller.revert();
        return;
      case "addActiveFile":
        await addActiveFile(this.controller);
        return;
      case "addSelection":
        addSelection(this.controller);
        return;
      case "removeContext":
        this.controller.removeContext(message.id);
        return;
      case "openPanel":
        this.openPanel();
        return;
      case "openSettings":
        await vscode.commands.executeCommand(
          "workbench.action.openSettings",
          "opencodeStudio",
        );
        return;
      case "configureInstructions":
        await vscode.commands.executeCommand("opencodeStudio.configureInstructions");
        return;
      default:
        return;
    }
  }

  private post(webview: vscode.Webview, message: HostToWebview): void {
    void webview.postMessage(message);
  }

  private options(): vscode.WebviewOptions & vscode.WebviewPanelOptions {
    return {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, "dist"),
        vscode.Uri.joinPath(this.context.extensionUri, "media"),
      ],
      retainContextWhenHidden: true,
    };
  }

  private html(webview: vscode.Webview, surface: string): string {
    const script = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "dist", "webview.js"),
    );
    const style = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "dist", "webview.css"),
    );
    const nonce = Math.random().toString(36).slice(2);
    return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<link rel="stylesheet" href="${style}" />
<title>OpenCode Studio</title>
</head>
<body>
<div id="root" data-surface="${surface}"></div>
<script nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
  }
}

function asMessage(message: unknown) {
  return message as import("../shared/protocol.js").WebviewToHost;
}

async function addActiveFile(controller: StudioController): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;
  const relative = vscode.workspace.asRelativePath(editor.document.uri);
  const text = await vscode.workspace.fs.readFile(editor.document.uri);
  const body = Buffer.from(text).toString("utf8");
  controller.addContext(
    relative,
    `File: ${relative}\n\`\`\`\n${clip(body)}\n\`\`\``,
  );
}

function addSelection(controller: StudioController): void {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.selection.isEmpty) return;
  const relative = vscode.workspace.asRelativePath(editor.document.uri);
  const text = editor.document.getText(editor.selection);
  const line = editor.selection.start.line + 1;
  controller.addContext(
    `${relative}:${line}`,
    `Selection: ${relative}:${line}\n\`\`\`\n${clip(text)}\n\`\`\``,
  );
}

async function openPatch(file: string, snapshot: ReturnType<StudioController["snapshot"]>): Promise<void> {
  const diff = snapshot.diffs.find((item) => item.file === file);
  if (!diff) return;
  const folder = vscode.workspace.workspaceFolders?.[0];
  const target = folder
    ? vscode.Uri.joinPath(folder.uri, file)
    : vscode.Uri.file(file);
  const original = await vscode.workspace.fs.readFile(target).then(
    (bytes) => Buffer.from(bytes).toString("utf8"),
    () => "",
  );
  const left = await vscode.workspace.openTextDocument({
    content: original,
    language: languageOf(file),
  });
  const right = await vscode.workspace.openTextDocument({
    content: applyPatchPreview(original, diff.patch, diff.status),
    language: languageOf(file),
  });
  await vscode.commands.executeCommand(
    "vscode.diff",
    left.uri,
    right.uri,
    `OpenCode: ${file}`,
  );
  const open = "ファイルを開く";
  const choice = await vscode.window.showInformationMessage(
    `${file} (${diff.status}, +${diff.additions} -${diff.deletions})`,
    open,
  );
  if (choice === open) await vscode.window.showTextDocument(target);
}

function applyPatchPreview(original: string, patch: string, status: string): string {
  if (status === "deleted") return "";
  if (status === "added") return addedFromPatch(patch) || original;
  return addedFromPatch(patch) || `${original}\n\n${patch}`;
}

function addedFromPatch(patch: string): string {
  const lines = patch.split("\n");
  const body = lines.filter(
    (line) =>
      (line.startsWith("+") && !line.startsWith("+++")) ||
      (!line.startsWith("-") && !line.startsWith("@@") && !line.startsWith("diff") && !line.startsWith("index") && !line.startsWith("---") && !line.startsWith("+++")),
  );
  return body.map((line) => (line.startsWith("+") ? line.slice(1) : line)).join("\n").trim();
}

function languageOf(file: string): string {
  const ext = path.extname(file).slice(1);
  if (ext === "ts" || ext === "tsx") return "typescript";
  if (ext === "js" || ext === "jsx") return "javascript";
  if (ext === "md") return "markdown";
  if (ext === "py") return "python";
  if (ext === "json") return "json";
  return ext || "plaintext";
}

function clip(text: string): string {
  const max = 20_000;
  return text.length > max ? `${text.slice(0, max)}\n…` : text;
}
