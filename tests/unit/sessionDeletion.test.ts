// Copyright (C) 2014-2026 Laurier Sylph. All rights reserved.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";

const mocks = vi.hoisted(() => ({
  events: [] as ((event: { type: string; data: unknown }) => void)[],
  list: vi.fn(), remove: vi.fn(), messages: vi.fn(), diff: vi.fn(),
  get: vi.fn(), permissions: vi.fn(), prompt: vi.fn(), interrupt: vi.fn(),
}));

vi.mock("vscode", () => ({
  workspace: {
    workspaceFolders: [{ uri: { fsPath: "/workspace" } }],
    getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }),
  },
}));

vi.mock("../../src/opencode/connection.js", () => ({
  OpenCodeConnection: class {
    live: unknown;
    async connect() {
      this.live = {
        version: "2.2.1", endpoint: { url: "http://localhost" },
        client: {
          model: {
            list: async () => ({ data: ["initial", "restored"].map((id) => ({ id, providerID: "p" })) }),
            default: async () => ({}),
          },
          agent: { list: async () => ({ data: [] }) },
          session: {
            list: mocks.list, remove: mocks.remove, get: mocks.get, diff: mocks.diff,
            prompt: mocks.prompt, interrupt: mocks.interrupt,
          },
          message: { list: mocks.messages },
          permission: { list: mocks.permissions },
        },
      };
      return this.live;
    }
    subscribe(callback: (event: { type: string; data: unknown }) => void) { mocks.events.push(callback); }
    dispose() {}
  },
}));

import { StudioController } from "../../src/state/controller.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

const sessions = [{ id: "active", title: "Active" }, { id: "other", title: "Other" }];
const transcript = { data: [{ type: "user", id: "message", text: "Saved text" }] };
const diffs = [{ file: "example.ts", status: "modified", patch: "+code", additions: 1, deletions: 0 }];
const approvals = [{ id: "approval", sessionID: "other", action: "edit", resources: [] }];
const emit = (type: string, sessionID = "active", data = {}) => mocks.events[0]!({
  type, data: { sessionID, ...data },
});

async function connected() {
  const host = new StudioController({ appendLine: vi.fn() } as unknown as vscode.OutputChannel);
  await host.connect();
  await host.selectSession("active");
  return host;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.events = [];
  mocks.list.mockResolvedValue({ data: sessions });
  mocks.remove.mockResolvedValue(undefined);
  mocks.messages.mockResolvedValue(transcript);
  mocks.diff.mockResolvedValue(diffs);
  mocks.get.mockResolvedValue({});
  mocks.permissions.mockResolvedValue([]);
  mocks.prompt.mockResolvedValue(undefined);
  mocks.interrupt.mockResolvedValue({ interrupted: true });
});

describe("session history deletion", () => {
  it("clears the active transcript, diffs and activity only after successful deletion", async () => {
    const host = await connected();
    host.addContext("context", "Keep this");
    mocks.permissions.mockResolvedValueOnce(approvals);
    await host.selectSession("active");
    emit("session.execution.succeeded");
    const pending = deferred<void>();
    mocks.remove.mockReturnValueOnce(pending.promise);
    const deletion = host.deleteSession("active");
    expect(host.snapshot()).toMatchObject({ activeSessionID: "active", phase: "completed" });
    expect(host.snapshot().items).not.toEqual([]);
    pending.resolve();
    await deletion;
    expect(mocks.remove).toHaveBeenCalledExactlyOnceWith({ sessionID: "active" });
    expect(host.snapshot()).toMatchObject({
      activeSessionID: undefined, items: [], diffs: [], phase: "idle",
      sessions: [expect.objectContaining({ id: "other" })],
      contexts: [expect.objectContaining({ text: "Keep this" })], approvals,
    });
    await host.selectSession("active");
    await host.deleteSession("active");
    emit("session.text.delta", "active", { assistantMessageID: "late", delta: "stale" });
    expect(host.snapshot().items).toEqual([]);
    expect(mocks.remove).toHaveBeenCalledTimes(1);
  });

  it("deletes inactive history and its approvals without changing active work", async () => {
    const host = await connected();
    mocks.permissions.mockResolvedValueOnce(approvals);
    await host.selectSession("active");
    emit("session.execution.started");
    const before = host.snapshot();
    await host.deleteSession("other");
    expect(host.snapshot()).toMatchObject({
      activeSessionID: "active", phase: "running", items: before.items, diffs: before.diffs,
      sessions: [expect.objectContaining({ id: "active" })],
    });
    emit("session.execution.interrupted");
    await host.deleteSession("active");
    expect(host.snapshot().approvals).toEqual([]);
  });

  it.each(["sending", "running", "awaitingApproval", "cancelling"])("blocks active deletion while %s", async (phase) => {
    const host = await connected();
    const prompt = deferred<void>();
    let sending: Promise<void> | undefined;
    if (phase === "sending") {
      mocks.prompt.mockReturnValueOnce(prompt.promise);
      sending = host.send("hello");
    } else if (phase === "awaitingApproval") {
      mocks.permissions.mockResolvedValueOnce([{ ...approvals[0], sessionID: "active" }]);
      await host.selectSession("active");
    } else {
      emit("session.execution.started");
      if (phase === "cancelling") {
        mocks.interrupt.mockResolvedValueOnce({ interrupted: false });
        await host.stop();
      }
    }
    expect(host.snapshot().phase).toBe(phase);
    const before = host.snapshot();
    await expect(host.deleteSession("active")).rejects.toThrow("実行中");
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(host.snapshot()).toEqual(before);
    prompt.resolve();
    await sending;
  });

  it("preserves all state on API failure and permits retry", async () => {
    const host = await connected();
    const before = host.snapshot();
    mocks.remove.mockRejectedValueOnce(new Error("remove failed"));
    await expect(host.deleteSession("active")).rejects.toThrow("remove failed");
    expect(host.snapshot()).toEqual(before);
    await host.deleteSession("active");
    expect(mocks.remove).toHaveBeenCalledTimes(2);
    expect(host.snapshot().activeSessionID).toBeUndefined();
  });

  it("blocks duplicate deletion, selection and sending while removal is pending", async () => {
    const host = await connected();
    const pending = deferred<void>();
    mocks.remove.mockReturnValueOnce(pending.promise);
    const deletion = host.deleteSession("active");
    await host.deleteSession("active");
    await host.selectSession("active");
    await expect(host.send("hello")).rejects.toThrow("削除しています");
    expect(mocks.remove).toHaveBeenCalledTimes(1);
    expect(mocks.get).toHaveBeenCalledTimes(1);
    expect(mocks.prompt).not.toHaveBeenCalled();
    pending.resolve();
    await deletion;
  });

  it("does not clear another session selected during deletion", async () => {
    const host = await connected();
    const pending = deferred<void>();
    mocks.remove.mockReturnValueOnce(pending.promise);
    const deletion = host.deleteSession("active");
    await host.selectSession("other");
    const before = host.snapshot();
    pending.resolve();
    await deletion;
    expect(host.snapshot()).toMatchObject({ activeSessionID: "other", items: before.items, diffs: before.diffs });
  });

  it.each(["transcript", "diffs", "session", "list"])("ignores a stale %s refresh after deletion", async (refresh) => {
    const host = await connected();
    const pending = deferred<unknown>();
    let selection: Promise<void> | undefined;
    if (refresh === "transcript") {
      mocks.messages.mockReturnValueOnce(pending.promise);
      emit("session.tool.success");
    } else if (refresh === "diffs") {
      mocks.diff.mockReturnValueOnce(pending.promise);
      emit("session.idle");
    } else if (refresh === "session") {
      mocks.get.mockReturnValueOnce(pending.promise);
      selection = host.selectSession("active");
    } else {
      mocks.list.mockReturnValueOnce(pending.promise);
      emit("session.renamed", "other");
    }
    await host.deleteSession("active");
    const after = host.snapshot();
    pending.resolve(refresh === "transcript" ? transcript : refresh === "diffs" ? diffs
      : refresh === "list" ? { data: sessions } : { agent: "stale" });
    await selection;
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(host.snapshot()).toEqual(after);
  });

  it("does not restore approval activity after deletion during model persistence", async () => {
    const storage = deferred<void>();
    const update = vi.fn().mockReturnValue(storage.promise);
    const host = new StudioController({ appendLine: vi.fn() } as unknown as vscode.OutputChannel, {
      get: vi.fn(), update,
    });
    await host.connect();
    mocks.get.mockResolvedValueOnce({ model: { id: "restored", providerID: "p" } });
    mocks.permissions.mockResolvedValueOnce([{ ...approvals[0], sessionID: "active" }]);
    const selection = host.selectSession("active");
    await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    await host.deleteSession("active");
    const after = host.snapshot();
    storage.resolve();
    await selection;
    expect(host.snapshot()).toEqual(after);
  });
});
