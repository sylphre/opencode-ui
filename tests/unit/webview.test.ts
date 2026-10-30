// Copyright (C) 2014-2026 Laurier Sylph. All rights reserved.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as VSCode from "vscode";
import type { StudioSnapshot } from "../../src/shared/protocol.js";

const mocks = vi.hoisted(() => ({
  commands: new Map<string, (...args: unknown[]) => unknown>(),
  executeCommand: vi.fn(),
  registerProvider: vi.fn(),
  createPanel: vi.fn(),
  quickPick: vi.fn(),
  showErrorMessage: vi.fn(),
  connect: vi.fn(),
  settingsGet: vi.fn((_key: string, fallback: unknown) => fallback),
  workspace: { workspaceFolders: undefined as { uri: { fsPath: string } }[] | undefined },
}));

vi.mock("vscode", () => {
  class Disposable {
    constructor(private readonly callback = () => {}) {}
    dispose() { this.callback(); }
    static from(...items: Disposable[]) {
      return new Disposable(() => items.forEach((item) => item.dispose()));
    }
  }
  return {
    Disposable,
    ViewColumn: { Beside: 2 },
    Uri: { joinPath: (_base: unknown, ...parts: string[]) => parts.join("/") },
    commands: {
      executeCommand: mocks.executeCommand,
      registerCommand: (name: string, callback: (...args: unknown[]) => unknown) => {
        mocks.commands.set(name, callback);
        return new Disposable(() => { mocks.commands.delete(name); });
      },
    },
    workspace: Object.assign(mocks.workspace, {
      getConfiguration: () => ({ get: mocks.settingsGet }),
    }),
    window: {
      createOutputChannel: () => ({ appendLine: vi.fn(), dispose: vi.fn() }),
      registerWebviewViewProvider: mocks.registerProvider,
      createWebviewPanel: mocks.createPanel,
      showQuickPick: mocks.quickPick,
      showErrorMessage: mocks.showErrorMessage,
    },
  };
});

vi.mock("../../src/opencode/connection.js", () => ({
  OpenCodeConnection: class {
    live = undefined;
    connect = mocks.connect;
    dispose() {}
  },
}));

import * as vscode from "vscode";
import { StudioView } from "../../src/providers/webview.js";
import { StudioController } from "../../src/state/controller.js";
import { activate } from "../../src/extension.js";

function context() {
  return {
    extensionUri: {}, subscriptions: [],
    workspaceState: { get: vi.fn(), update: vi.fn().mockResolvedValue(undefined) },
  } as unknown as VSCode.ExtensionContext;
}

function surface(onLoad = () => {}) {
  const listeners = new Set<(message: unknown) => Promise<void>>();
  let dispose = () => {};
  const webview = {
    options: {},
    set html(_value: string) { onLoad(); },
    asWebviewUri: (uri: unknown) => String(uri),
    cspSource: "test",
    postMessage: vi.fn().mockResolvedValue(true),
    onDidReceiveMessage: (listener: (message: unknown) => Promise<void>) => {
      listeners.add(listener);
      return new vscode.Disposable(() => { listeners.delete(listener); });
    },
  };
  return {
    view: { webview, onDidDispose: (callback: () => void) => { dispose = callback; } } as unknown as VSCode.WebviewView,
    post: webview.postMessage,
    emit: (message: unknown) => Promise.all([...listeners].map((listener) => listener(message))),
    listenerCount: () => listeners.size,
    dispose: () => dispose(),
  };
}

function controller() {
  return new StudioController({ appendLine: vi.fn() } as unknown as VSCode.OutputChannel);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.commands.clear();
  mocks.workspace.workspaceFolders = undefined;
  mocks.settingsGet.mockImplementation((_key, fallback) => fallback);
  mocks.executeCommand.mockImplementation(async (name: string) => mocks.commands.get(name)?.());
  mocks.registerProvider.mockReturnValue(new vscode.Disposable(() => {}));
});

describe("webview lifecycle", () => {
  it("posts ready state before waiting for automatic connection", async () => {
    const host = controller();
    let finish!: () => void;
    vi.spyOn(host, "connect").mockReturnValue(new Promise<void>((resolve) => { finish = resolve; }));
    const ui = surface();
    new StudioView(context(), host).resolveSidebar(ui.view);
    ui.post.mockClear();
    const pending = ui.emit({ type: "ready" });
    expect(ui.post).toHaveBeenCalledExactlyOnceWith({ type: "snapshot", snapshot: host.snapshot() });
    finish();
    await pending;
  });

  it.each([false, true])("replays the current snapshot on every ready with autoConnect=%s", async (autoConnect) => {
    mocks.settingsGet.mockImplementation((key, fallback) => key === "autoConnect" ? autoConnect : fallback);
    const host = controller();
    const connect = vi.spyOn(host, "connect").mockResolvedValue();
    const initial = host.snapshot();
    let current: StudioSnapshot = initial;
    vi.spyOn(host, "snapshot").mockImplementation(() => current);
    const ui = surface();
    new StudioView(context(), host).resolveSidebar(ui.view);
    // Simulate an initial post lost before React's message listener exists.
    ui.post.mockClear();
    current = { ...initial, phase: "running", detail: "Current work" };
    await ui.emit({ type: "ready" });
    expect(ui.post).toHaveBeenLastCalledWith({ type: "snapshot", snapshot: current });
    expect(connect).not.toHaveBeenCalled();
    current = { ...initial, detail: "Disconnected now" };
    await ui.emit({ type: "ready" });
    expect(ui.post).toHaveBeenLastCalledWith({ type: "snapshot", snapshot: current });
    expect(connect).toHaveBeenCalledTimes(autoConnect ? 1 : 0);
  });

  it("installs reception before HTML loads and disposes both listeners on recreation", async () => {
    const host = controller();
    const studio = new StudioView(context(), host);
    const ui = surface(() => { expect(ui.listenerCount()).toBe(1); });
    studio.resolveSidebar(ui.view);
    ui.dispose();
    ui.post.mockClear();
    host.addContext("test", "test");
    await ui.emit({ type: "configureInstructions" });
    expect(ui.post).not.toHaveBeenCalled();
    expect(mocks.executeCommand).not.toHaveBeenCalled();
    expect(ui.listenerCount()).toBe(0);
    const replacement = surface();
    studio.resolveSidebar(replacement.view);
    await replacement.emit({ type: "configureInstructions" });
    expect(mocks.executeCommand).toHaveBeenCalledExactlyOnceWith("opencodeStudio.configureInstructions");
  });

  it("awaits asynchronous command failures, reports them, and accepts subsequent actions", async () => {
    const ui = surface();
    new StudioView(context(), controller()).resolveSidebar(ui.view);
    let reject!: (error: Error) => void;
    mocks.executeCommand.mockReturnValueOnce(new Promise((_resolve, fail) => { reject = fail; }));
    const pending = ui.emit({ type: "configureInstructions" });
    expect(ui.post).not.toHaveBeenCalledWith(expect.objectContaining({ type: "error" }));
    reject(new Error("Command failed"));
    await pending;
    expect(ui.post).toHaveBeenLastCalledWith({ type: "error", message: "Command failed" });
    await ui.emit({ type: "openSettings" });
    expect(mocks.executeCommand).toHaveBeenLastCalledWith("workbench.action.openSettings", "opencodeStudio");
    await ui.emit({ type: "configureInstructions", path: "outside" });
    await ui.emit(null);
    expect(mocks.executeCommand).toHaveBeenCalledTimes(2);
  });

  it("shares current state with a panel and removes its listeners when closed", async () => {
    const host = controller();
    const studio = new StudioView(context(), host);
    const sidebar = surface();
    const panel = surface();
    const reveal = vi.fn();
    mocks.createPanel.mockReturnValue({ ...panel.view, reveal });
    studio.resolveSidebar(sidebar.view);
    studio.openPanel();
    studio.openPanel();
    expect(reveal).toHaveBeenCalledTimes(1);
    host.addContext("current", "current");
    await panel.emit({ type: "ready" });
    expect(panel.post).toHaveBeenLastCalledWith({ type: "snapshot", snapshot: host.snapshot() });
    panel.dispose();
    panel.post.mockClear();
    host.addContext("later", "later");
    expect(panel.listenerCount()).toBe(0);
    expect(panel.post).not.toHaveBeenCalled();
    expect(sidebar.post).toHaveBeenLastCalledWith({ type: "snapshot", snapshot: host.snapshot() });
    sidebar.dispose();
  });
});

describe("extension instruction command binding", () => {
  it("dispatches from the registered sidebar to the real instruction picker and releases the guard on cancel", async () => {
    const ctx = context();
    activate(ctx);
    mocks.workspace.workspaceFolders = [{ uri: { fsPath: "/virtual-workspace" } }];
    const provider = mocks.registerProvider.mock.calls[0]![1];
    const ui = surface();
    provider.resolveWebviewView(ui.view);
    mocks.quickPick.mockResolvedValue(undefined);
    await ui.emit({ type: "configureInstructions" });
    await ui.emit({ type: "configureInstructions" });
    expect(mocks.quickPick).toHaveBeenCalledTimes(2);
    expect(mocks.quickPick).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ action: "instructions" }),
      expect.objectContaining({ action: "system" }),
    ]), expect.objectContaining({ title: "OpenCode Workspace Instructions" }));
    ctx.subscriptions.forEach((item) => item.dispose());
    ui.dispose();
  });

  it("reports instruction precondition errors without leaving the command locked", async () => {
    const ctx = context();
    activate(ctx);
    await vscode.commands.executeCommand("opencodeStudio.configureInstructions");
    expect(mocks.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining("exactly one workspace"));
    mocks.workspace.workspaceFolders = [{ uri: { fsPath: "/virtual-workspace" } }];
    mocks.quickPick.mockResolvedValue(undefined);
    await vscode.commands.executeCommand("opencodeStudio.configureInstructions");
    expect(mocks.quickPick).toHaveBeenCalledTimes(1);
    ctx.subscriptions.forEach((item) => item.dispose());
  });
});

describe("connection retry", () => {
  it("allows reconnect after opening a workspace following a no-folder failure", async () => {
    const host = controller();
    await host.connect();
    expect(host.snapshot().phase).toBe("failed");
    mocks.workspace.workspaceFolders = [{ uri: { fsPath: "/virtual-workspace" } }];
    mocks.connect.mockRejectedValue(new Error("Service unavailable"));
    await host.connect();
    expect(mocks.connect).toHaveBeenCalledTimes(1);
    expect(host.snapshot().detail).toBe("Service unavailable");
  });

  it("releases the connecting flag when settings throw", async () => {
    const host = controller();
    mocks.settingsGet.mockImplementationOnce(() => { throw new Error("Invalid settings"); });
    await host.connect();
    expect(host.snapshot().detail).toBe("Invalid settings");
    mocks.workspace.workspaceFolders = [{ uri: { fsPath: "/virtual-workspace" } }];
    mocks.connect.mockRejectedValue(new Error("Service unavailable"));
    await host.connect();
    expect(mocks.connect).toHaveBeenCalledTimes(1);
  });
});
