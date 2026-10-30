// Copyright (C) 2014-2026 Laurier Sylph. All rights reserved.
import * as vscode from "vscode";
import { StudioView } from "./providers/webview.js";
import { StudioController } from "./state/controller.js";
import { configureInstructions } from "./config/configureInstructions.js";

let controller: StudioController | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("OpenCode Studio");
  controller = new StudioController(output, context.workspaceState);
  const view = new StudioView(context, controller);

  context.subscriptions.push(
    output,
    controller,
    vscode.window.registerWebviewViewProvider("opencodeStudio.sidebar", {
      resolveWebviewView: (webviewView) => view.resolveSidebar(webviewView),
    }),
    vscode.commands.registerCommand("opencodeStudio.open", () =>
      vscode.commands.executeCommand("opencodeStudio.sidebar.focus"),
    ),
    vscode.commands.registerCommand("opencodeStudio.connect", () => controller?.connect()),
    vscode.commands.registerCommand("opencodeStudio.disconnect", () => controller?.disconnect()),
    vscode.commands.registerCommand("opencodeStudio.newSession", () => controller?.newSession()),
    vscode.commands.registerCommand("opencodeStudio.openPanel", () => view.openPanel()),
    vscode.commands.registerCommand("opencodeStudio.stop", () => controller?.stop()),
    vscode.commands.registerCommand("opencodeStudio.configureInstructions", configureInstructions),
    vscode.commands.registerCommand("opencodeStudio.addFileContext", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || !controller) return;
      const relative = vscode.workspace.asRelativePath(editor.document.uri);
      controller.addContext(relative, `File: ${relative}`);
    }),
    vscode.commands.registerCommand("opencodeStudio.addSelectionContext", () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.selection.isEmpty || !controller) return;
      const relative = vscode.workspace.asRelativePath(editor.document.uri);
      const text = editor.document.getText(editor.selection);
      controller.addContext(`${relative}`, `Selection: ${relative}\n${text}`);
    }),
  );

  }

export function deactivate(): void {
  controller?.dispose();
}
