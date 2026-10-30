// Copyright (C) 2014-2026 Laurier Sylph. All rights reserved.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";

const mocks = vi.hoisted(() => ({
  defaultModel: "p/initial",
  serverDefault: "server",
  models: ["initial", "chosen", "server"],
  variants: ["low", "max"],
  events: [] as ((event: { type: string; data: unknown }) => void)[],
  switchModel: vi.fn(),
  create: vi.fn(),
  getSession: vi.fn(),
}));

vi.mock("vscode", () => ({
  workspace: {
    workspaceFolders: [{ uri: { fsPath: "/workspace" } }],
    getConfiguration: () => ({
      get: (key: string, fallback: unknown) => key === "defaultModel" ? mocks.defaultModel : fallback,
    }),
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
            list: async () => ({ data: mocks.models.map((id) => ({
              id, providerID: "p", name: id, variants: mocks.variants.map((id) => ({ id })),
            })) }),
            default: async () => ({ data: { providerID: "p", modelID: mocks.serverDefault } }),
          },
          agent: { list: async () => ({ data: [{ id: "build", mode: "primary" }] }) },
          session: {
            list: async () => ({ data: [] }),
            create: mocks.create,
            switchModel: mocks.switchModel,
            get: mocks.getSession,
            diff: async () => [],
          },
          message: { list: async () => ({ data: [] }) },
          permission: { list: async () => [] },
        },
      };
      return this.live;
    }
    subscribe(callback: (event: { type: string; data: unknown }) => void) {
      mocks.events.push(callback);
    }
    async disconnect() { this.live = undefined; }
    dispose() { this.live = undefined; }
  },
}));

import { StudioController } from "../../src/state/controller.js";

const key = "opencodeStudio.modelSelection";

function memento(initial?: unknown) {
  const values = new Map<string, unknown>(initial === undefined ? [] : [[key, initial]]);
  return {
    get: vi.fn(<T>(name: string, fallback?: T): T | undefined =>
      values.has(name) ? values.get(name) as T : fallback),
    update: vi.fn(async (name: string, value: unknown) => { values.set(name, value); }),
    values,
  };
}

function controller(state?: Pick<vscode.Memento, "get" | "update">) {
  const output = { appendLine: vi.fn() };
  return { host: new StudioController(output as unknown as vscode.OutputChannel, state), output };
}

async function connected(state = memento()) {
  const result = controller(state);
  await result.host.connect();
  expect(result.host.snapshot().phase).toBe("idle");
  return { ...result, state };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.defaultModel = "p/initial";
  mocks.serverDefault = "server";
  mocks.models = ["initial", "chosen", "server"];
  mocks.variants = ["low", "max"];
  mocks.events = [];
  mocks.switchModel.mockResolvedValue(undefined);
  mocks.create.mockResolvedValue({ id: "session-1" });
  mocks.getSession.mockResolvedValue({});
});

describe("workspace model selection", () => {
  it.each(["low", "max", "default"])("restores %s after a fresh controller restart and uses it for session creation", async (variant) => {
    const state = memento();
    const { host } = await connected(state);
    await host.newSession();
    await host.setModel("p", "chosen", "max");
    await host.setModel("p", "chosen", variant);
    const expected = variant === "default" ? undefined : variant;
    expect(mocks.switchModel).toHaveBeenLastCalledWith({
      sessionID: "session-1",
      model: { id: "chosen", providerID: "p", ...(expected ? { variant: expected } : {}) },
    });
    host.addContext("private", "not persisted");
    host.dispose();
    const { host: restarted } = await connected(state);
    expect(restarted.snapshot()).toMatchObject({ selectedModel: "p/chosen", selectedVariant: expected });
    expect(restarted.snapshot().activeSessionID).toBeUndefined();
    expect(restarted.snapshot().contexts).toEqual([]);
    await restarted.newSession();
    expect(mocks.create).toHaveBeenLastCalledWith({
      location: { directory: "/workspace" }, agent: "build", title: "New session",
      model: { id: "chosen", providerID: "p", ...(expected ? { variant: expected } : {}) },
    });
    expect([...state.values.entries()]).toEqual([[key, {
      model: "p/chosen", ...(expected ? { variant: expected } : {}),
    }]]);
    const { host: otherWorkspace } = await connected(memento());
    expect(otherWorkspace.snapshot().selectedModel).toBe("p/initial");
  });

  it.each([
    ["p/initial", "server", "p/initial"],
    ["p/missing", "server", "p/server"],
    ["", "missing", "p/initial"],
  ])("uses valid initial defaults (%s, %s)", async (configured, server, expected) => {
    mocks.defaultModel = configured;
    mocks.serverDefault = server;
    const { host, state } = await connected();
    expect(host.snapshot().selectedModel).toBe(expected);
    expect(state.update).not.toHaveBeenCalled();
  });

  it.each([null, 42, "p/chosen", [], {}, { model: 42 }, { model: "p/missing", variant: "max" }])(
    "ignores corrupt or unavailable saved models: %j", async (saved) => {
      const { host } = await connected(memento(saved));
      expect(host.snapshot()).toMatchObject({ selectedModel: "p/initial", selectedVariant: undefined });
    },
  );

  it.each(["missing", "default", 42, {}, null])("clears unsupported or corrupt variants: %j", async (variant) => {
    const { host } = await connected(memento({ model: "p/chosen", variant }));
    expect(host.snapshot()).toMatchObject({ selectedModel: "p/chosen", selectedVariant: undefined });
    await host.newSession();
    expect(mocks.create.mock.calls[0]![0].model).toEqual({ id: "chosen", providerID: "p" });
  });

  it("falls back without carrying a removed model's variant", async () => {
    mocks.defaultModel = "p/missing";
    const { host } = await connected(memento({ model: "p/removed", variant: "max" }));
    expect(host.snapshot()).toMatchObject({ selectedModel: "p/server", selectedVariant: undefined });
  });

  it("handles an empty catalog", async () => {
    mocks.models = [];
    const { host } = await connected(memento({ model: "p/chosen", variant: "max" }));
    expect(host.snapshot().selectedModel).toBeUndefined();
    expect(host.snapshot().selectedVariant).toBeUndefined();
    await host.newSession();
    expect(mocks.create.mock.calls[0]![0]).not.toHaveProperty("model");
  });

  it("validates variants again after the catalog changes", async () => {
    const { host, state } = await connected();
    await host.setModel("p", "chosen", "max");
    host.dispose();
    mocks.variants = ["low"];
    const { host: restarted } = await connected(state);
    expect(restarted.snapshot()).toMatchObject({ selectedModel: "p/chosen", selectedVariant: undefined });
  });

  it("does not save or change selection when a switch fails", async () => {
    const { host, state } = await connected();
    await host.setModel("p", "chosen", "low");
    await host.newSession();
    state.update.mockClear();
    mocks.switchModel.mockRejectedValueOnce(new Error("switch failed"));
    await expect(host.setModel("p", "initial", "max")).rejects.toThrow("switch failed");
    await expect(host.setModel("p", "missing")).rejects.toThrow();
    expect(state.update).not.toHaveBeenCalled();
    expect(host.snapshot()).toMatchObject({ selectedModel: "p/chosen", selectedVariant: "low" });
    expect(state.values.get(key)).toEqual({ model: "p/chosen", variant: "low" });
  });

  it("awaits the workspace write before setModel resolves", async () => {
    const { host, state } = await connected();
    let finish!: () => void;
    state.update.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    let completed = false;
    const pending = host.setModel("p", "chosen", "low").then(() => { completed = true; });
    await Promise.resolve();
    expect(completed).toBe(false);
    finish();
    await pending;
    expect(completed).toBe(true);
  });

  it("keeps the live selection and connection when a write fails", async () => {
    const { host, state, output } = await connected();
    state.update.mockRejectedValueOnce(new Error("storage unavailable"));
    await expect(host.setModel("p", "chosen", "max")).resolves.toBeUndefined();
    expect(host.snapshot()).toMatchObject({ phase: "idle", selectedModel: "p/chosen", selectedVariant: "max" });
    expect(output.appendLine).toHaveBeenCalledWith(expect.stringContaining("storage unavailable"));
  });

  it("does not fail connection when reading storage throws", async () => {
    const state = memento();
    state.get.mockImplementation(() => { throw new Error("bad storage"); });
    const { host, output } = await connected(state);
    expect(host.snapshot().selectedModel).toBe("p/initial");
    expect(output.appendLine).toHaveBeenCalledWith(expect.stringContaining("bad storage"));
  });

  it("preserves a selection on reconnect without persistence injection", async () => {
    const { host } = controller();
    await host.connect();
    await host.setModel("p", "chosen", "low");
    await host.disconnect();
    await host.connect();
    expect(host.snapshot()).toMatchObject({ selectedModel: "p/chosen", selectedVariant: "low" });
  });

  it("saves the actual model restored from a session", async () => {
    const { host, state } = await connected();
    mocks.getSession.mockResolvedValue({ model: { providerID: "p", id: "chosen", variant: "max" } });
    await host.selectSession("existing");
    expect(state.values.get(key)).toEqual({ model: "p/chosen", variant: "max" });
    host.dispose();
    const { host: restarted } = await connected(state);
    expect(restarted.snapshot()).toMatchObject({ selectedModel: "p/chosen", selectedVariant: "max" });
    expect(restarted.snapshot().activeSessionID).toBeUndefined();
  });

  it("keeps the valid selection when a session references an unavailable model", async () => {
    const { host, state } = await connected(memento({ model: "p/chosen", variant: "low" }));
    mocks.getSession.mockResolvedValue({ model: { providerID: "p", id: "removed", variant: "max" } });
    await host.selectSession("existing");
    expect(host.snapshot()).toMatchObject({ selectedModel: "p/chosen", selectedVariant: "low" });
    expect(state.update).not.toHaveBeenCalled();
  });

  it("finishes session restoration even when saving fails", async () => {
    const { host, state, output } = await connected();
    mocks.getSession.mockResolvedValue({ model: { providerID: "p", id: "chosen", variant: "max" } });
    state.update.mockRejectedValueOnce(new Error("session save failed"));
    await expect(host.selectSession("existing")).resolves.toBeUndefined();
    expect(host.snapshot()).toMatchObject({ phase: "idle", selectedModel: "p/chosen", selectedVariant: "max" });
    expect(output.appendLine).toHaveBeenCalledWith(expect.stringContaining("session save failed"));
  });

  it("only saves valid changes from the active session's model.selected events", async () => {
    const { host, state, output } = await connected();
    await host.newSession();
    const emit = (sessionID: string, id: string, variant?: unknown) => mocks.events[0]!({
      type: "session.model.selected", data: { sessionID, model: { providerID: "p", id, variant } },
    });
    emit("other-session", "chosen", "max");
    emit("session-1", "missing", "max");
    expect(state.update).not.toHaveBeenCalled();
    emit("session-1", "chosen", "low");
    expect(state.values.get(key)).toEqual({ model: "p/chosen", variant: "low" });
    emit("session-1", "chosen", "low");
    expect(state.update).toHaveBeenCalledTimes(1);
    emit("session-1", "chosen", "default");
    expect(state.values.get(key)).toEqual({ model: "p/chosen" });
    state.update.mockRejectedValueOnce(new Error("event save failed"));
    emit("session-1", "chosen", "max");
    await Promise.resolve();
    expect(output.appendLine).toHaveBeenCalledWith(expect.stringContaining("event save failed"));
    expect(host.snapshot().phase).toBe("idle");
  });
});
