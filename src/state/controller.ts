// Copyright (C) 2014-2026 Laurier Sylph. All rights reserved.
import type { OpenCodeClient } from "@opencode/client";
import * as vscode from "vscode";
import { readSettings } from "../config/settings.js";
import { OpenCodeConnection } from "../opencode/connection.js";
import type {
  ApprovalRequest,
  ChatItem,
  ContextChip,
  StudioSnapshot,
} from "../shared/protocol.js";
import {
  contextBlock,
  listSessions,
  loadApprovals,
  loadCatalog,
  loadDiffs,
  loadTranscript,
  type Catalog,
} from "../session/store.js";
import { appendText, isRecord, upsertItem } from "../session/messages.js";
import { normalizeVariant, resolveVariant } from "../session/variant.js";
import { initialActivity, reduceActivity, type ActivityState } from "./activity.js";

type Listener = (snapshot: StudioSnapshot) => void;

export class StudioController implements vscode.Disposable {
  private readonly connection = new OpenCodeConnection();
  private readonly listeners = new Set<Listener>();
  private activity: ActivityState = initialActivity();
  private catalog: Catalog = { models: [], agents: [] };
  private sessions: StudioSnapshot["sessions"] = [];
  private items: ChatItem[] = [];
  private diffs: StudioSnapshot["diffs"] = [];
  private approvals: ApprovalRequest[] = [];
  private contexts: ContextChip[] = [];
  private activeSessionID: string | undefined;
  private selectedModel: string | undefined;
  private selectedVariant: string | undefined;
  private selectedAgent: string | undefined;
  private generation = 0;
  private directory = "";

  constructor(private readonly output: vscode.OutputChannel) {}

  subscribe(listener: Listener): vscode.Disposable {
    this.listeners.add(listener);
    listener(this.snapshot());
    return new vscode.Disposable(() => this.listeners.delete(listener));
  }

  snapshot(): StudioSnapshot {
    const live = this.connection.live;
    return {
      phase: this.activity.phase,
      detail: this.activity.detail,
      recoverable: this.activity.recoverable,
      version: live?.version,
      url: live?.endpoint.url,
      sessions: this.sessions,
      activeSessionID: this.activeSessionID,
      items: this.items,
      models: this.catalog.models,
      agents: this.catalog.agents.filter((agent) => !agent.hidden),
      selectedModel: this.selectedModel,
      selectedVariant: this.selectedVariant,
      selectedAgent: this.selectedAgent,
      diffs: this.diffs,
      approvals: this.approvals.filter(
        (item) => !this.activeSessionID || item.sessionID === this.activeSessionID,
      ),
      contexts: this.contexts,
      planAvailable: Boolean(this.catalog.planAgent),
      buildAvailable: Boolean(this.catalog.buildAgent),
    };
  }

  private connecting = false;

  async connect(): Promise<void> {
    if (this.connecting || this.connection.live) return;
    this.connecting = true;
    const settings = readSettings();
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      this.fail("ワークスペースを開いてから接続してください。");
      return;
    }
    this.directory = folder.uri.fsPath;
    this.activity = reduceActivity(this.activity, { type: "connect-start" });
    this.publish();
    try {
      const live = await this.connection.connect({
        executablePath: settings.executablePath,
        launchMode: settings.launchMode,
        timeoutMs: settings.connectTimeoutMs,
        directory: this.directory,
      });
      this.log(`connected ${live.version} ${live.endpoint.url}`);
      this.catalog = await loadCatalog(live.client, this.directory);
      this.applyDefaults(settings.defaultAgent, settings.defaultModel);
      this.sessions = await listSessions(live.client, this.directory);
      this.activity = reduceActivity(this.activity, { type: "connected" });
      this.connection.subscribe(
        (event) => this.onEvent(event),
        (error) => this.onStreamError(error),
      );
      if (this.activeSessionID) await this.refreshSession(this.activeSessionID);
      this.publish();
    } catch (error) {
      this.fail(errorText(error));
    } finally {
      this.connecting = false;
    }
  }

  async disconnect(): Promise<void> {
    await this.connection.disconnect();
    this.activity = reduceActivity(initialActivity(), {
      type: "disconnected",
      message: "切断しました",
    });
    this.publish();
  }

  async newSession(): Promise<void> {
    const client = this.requireClient();
    if (!client) return;
    const model = this.modelRef();
    const session = await client.session.create({
      location: { directory: this.directory },
      agent: this.selectedAgent,
      title: "New session",
      ...(model ? { model } : {}),
    });
    if (!session?.id) throw new Error("セッションを作成できませんでした。");
    this.activeSessionID = session.id;
    this.items = [];
    this.diffs = [];
    this.sessions = await listSessions(client, this.directory);
    this.publish();
  }

  async selectSession(sessionID: string): Promise<void> {
    this.activeSessionID = sessionID;
    this.items = [];
    this.publish();
    await this.refreshSession(sessionID);
  }

  async renameSession(sessionID: string, title: string): Promise<void> {
    const client = this.requireClient();
    if (!client) return;
    await client.session.update({ sessionID, title });
    this.sessions = await listSessions(client, this.directory);
    this.publish();
  }

  async deleteSession(sessionID: string): Promise<void> {
    const client = this.requireClient();
    if (!client) return;
    await client.session.remove({ sessionID });
    if (this.activeSessionID === sessionID) {
      this.activeSessionID = undefined;
      this.items = [];
      this.diffs = [];
    }
    this.sessions = await listSessions(client, this.directory);
    this.publish();
  }

  async send(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) return;
    const client = this.requireClient();
    if (!client) return;
    if (!this.activeSessionID) await this.newSession();
    const sessionID = this.activeSessionID;
    if (!sessionID) return;
    const body = `${contextBlock(this.contexts)}${trimmed}`;
    this.items = upsertItem(this.items, {
      kind: "text",
      id: `local-user-${Date.now()}`,
      role: "user",
      text: trimmed,
    });
    this.activity = reduceActivity(this.activity, { type: "sending" });
    this.publish();
    try {
      await client.session.prompt({ sessionID, text: body });
      this.activity = reduceActivity(this.activity, { type: "send-accepted" });
      this.publish();
    } catch (error) {
      this.activity = reduceActivity(this.activity, {
        type: "send-failed",
        message: errorText(error),
      });
      this.publish();
    }
  }

  async stop(): Promise<void> {
    const client = this.requireClient();
    const sessionID = this.activeSessionID;
    if (!client || !sessionID) return;
    this.activity = reduceActivity(this.activity, { type: "cancel-requested" });
    this.publish();
    try {
      const result = await client.session.interrupt({ sessionID });
      if (result?.interrupted) {
        this.activity = reduceActivity(this.activity, { type: "interrupted" });
        this.publish();
      }
    } catch (error) {
      this.activity = reduceActivity(this.activity, {
        type: "failed",
        message: errorText(error),
      });
      this.publish();
    }
  }

  async setModel(providerID: string, modelID: string, variant?: string): Promise<void> {
    const label = `${providerID}/${modelID}`;
    const choice = this.catalog.models.find((model) => model.label === label);
    if (!choice) throw new Error("指定したモデルは利用できません。");
    const next = resolveVariant(choice.variants, variant, this.selectedVariant);
    const client = this.connection.live?.client;
    if (client && this.activeSessionID) {
      // Errors propagate to the webview banner; selection stays unchanged on failure.
      await client.session.switchModel({
        sessionID: this.activeSessionID,
        model: next
          ? { id: choice.id, providerID: choice.providerID, variant: next }
          : { id: choice.id, providerID: choice.providerID },
      });
    }
    this.selectedModel = label;
    this.selectedVariant = next;
    this.publish();
  }

  async setAgent(agentID: string): Promise<void> {
    const known = this.catalog.agents.some((agent) => agent.id === agentID);
    if (!known) {
      this.fail("指定したエージェントは利用できません。");
      return;
    }
    this.selectedAgent = agentID;
    const client = this.connection.live?.client;
    if (client && this.activeSessionID) {
      await client.session.switchAgent({
        sessionID: this.activeSessionID,
        agent: agentID,
      });
    }
    this.publish();
  }

  async setMode(mode: "plan" | "build"): Promise<void> {
    const agentID = mode === "plan" ? this.catalog.planAgent : this.catalog.buildAgent;
    if (!agentID) {
      this.activity = {
        ...this.activity,
        detail: `${mode === "plan" ? "Plan" : "Build"} に対応するエージェントがありません`,
      };
      this.publish();
      return;
    }
    await this.setAgent(agentID);
  }

  async approve(requestID: string, decision: "once" | "always" | "reject"): Promise<void> {
    const client = this.requireClient();
    const approval = this.approvals.find((item) => item.id === requestID);
    if (!client || !approval) return;
    await client.permission.reply({
      sessionID: approval.sessionID,
      requestID,
      decision,
    });
    this.approvals = this.approvals.filter((item) => item.id !== requestID);
    this.activity = reduceActivity(this.activity, { type: "approval-cleared" });
    this.publish();
  }

  addContext(label: string, text: string): void {
    this.contexts = [
      ...this.contexts,
      { id: `${Date.now()}-${this.contexts.length}`, label, text },
    ];
    this.publish();
  }

  removeContext(id: string): void {
    this.contexts = this.contexts.filter((item) => item.id !== id);
    this.publish();
  }

  async revert(): Promise<void> {
    const client = this.requireClient();
    const sessionID = this.activeSessionID;
    if (!client || !sessionID) return;
    const session = await client.session.get({ sessionID });
    const messageID = session?.revert?.messageID;
    if (!messageID) {
      this.activity = {
        ...this.activity,
        detail: "安全に戻せるスナップショットがありません。変更はすでにワークスペースへ反映されています。",
      };
      this.publish();
      return;
    }
    await client.session.revert.stage({ sessionID, messageID, files: true });
    await client.session.revert.commit({ sessionID });
    this.diffs = await loadDiffs(client, sessionID);
    this.publish();
  }

  dispose(): void {
    this.connection.dispose();
  }

  private applyDefaults(agent: string, model: string): void {
    if (agent && this.catalog.agents.some((item) => item.id === agent)) {
      this.selectedAgent = agent;
    } else if (!this.selectedAgent) {
      this.selectedAgent =
        this.catalog.buildAgent ??
        this.catalog.agents.find((item) => item.id === "build")?.id;
    }
    if (model.includes("/")) this.selectedModel = model;
    else if (!this.selectedModel) {
      this.selectedModel = this.catalog.defaultModel ?? this.catalog.models[0]?.label;
    }
    if (this.selectedModel) {
      this.selectedVariant = normalizeVariant(
        this.selectedVariant,
        this.variantsOf(this.selectedModel),
      );
    }
  }

  private variantsOf(label: string): string[] {
    return this.catalog.models.find((item) => item.label === label)?.variants ?? [];
  }

  private modelRef(): { id: string; providerID: string; variant?: string } | undefined {
    const choice = this.catalog.models.find((item) => item.label === this.selectedModel);
    if (!choice) return undefined;
    const variant = normalizeVariant(this.selectedVariant, choice.variants);
    return variant
      ? { id: choice.id, providerID: choice.providerID, variant }
      : { id: choice.id, providerID: choice.providerID };
  }

  private async refreshSession(sessionID: string): Promise<void> {
    const client = this.connection.live?.client;
    if (!client) return;
    const generation = ++this.generation;
    const [items, diffs, approvals, session] = await Promise.all([
      loadTranscript(client, sessionID),
      loadDiffs(client, sessionID).catch(() => []),
      loadApprovals(client, sessionID).catch(() => []),
      client.session.get({ sessionID }).catch(() => undefined),
    ]);
    if (generation !== this.generation || this.activeSessionID !== sessionID) return;
    this.items = items;
    this.diffs = diffs;
    this.approvals = approvals;
    if (session?.agent) this.selectedAgent = session.agent;
    if (session?.model) {
      const label = `${session.model.providerID}/${session.model.id}`;
      this.selectedModel = label;
      this.selectedVariant = normalizeVariant(session.model.variant, this.variantsOf(label));
    }
    if (approvals.length > 0) {
      this.activity = reduceActivity(this.activity, { type: "approval" });
    }
    this.publish();
  }

  private onEvent(event: { type?: string; data?: unknown }): void {
    const type = event.type;
    const data = isRecord(event.data) ? event.data : {};
    const sessionID = typeof data.sessionID === "string" ? data.sessionID : undefined;
    if (!type || type === "server.connected") return;
    if (sessionID && this.activeSessionID && sessionID !== this.activeSessionID) {
      if (type === "session.deleted" || type === "session.created" || type === "session.renamed") {
        void this.reloadSessions();
      }
      return;
    }
    switch (type) {
      case "session.execution.started":
      case "session.status":
        if (isRecord(data.status) && data.status.type === "idle") {
          this.activity = reduceActivity(this.activity, { type: "idle" });
        } else if (type === "session.execution.started" || (isRecord(data.status) && data.status.type === "busy")) {
          this.activity = reduceActivity(this.activity, { type: "execution-started" });
        }
        break;
      case "session.execution.succeeded":
        this.activity = reduceActivity(this.activity, { type: "succeeded" });
        void this.reloadDiffs();
        break;
      case "session.execution.failed":
        this.activity = reduceActivity(this.activity, {
          type: "failed",
          message: errorText(isRecord(data.error) ? data.error.message : data.error),
        });
        break;
      case "session.execution.interrupted":
        this.activity = reduceActivity(this.activity, { type: "interrupted" });
        break;
      case "session.idle":
        this.activity = reduceActivity(this.activity, { type: "idle" });
        void this.reloadDiffs();
        break;
      case "session.text.delta":
        if (typeof data.delta === "string" && typeof data.assistantMessageID === "string") {
          const ordinal = typeof data.ordinal === "number" ? data.ordinal : 0;
          this.items = appendText(
            this.items,
            `${data.assistantMessageID}:text:${ordinal}`,
            "assistant",
            data.delta,
          );
        }
        break;
      case "session.text.ended":
        if (typeof data.text === "string" && typeof data.assistantMessageID === "string") {
          const ordinal = typeof data.ordinal === "number" ? data.ordinal : 0;
          this.items = upsertItem(this.items, {
            kind: "text",
            id: `${data.assistantMessageID}:text:${ordinal}`,
            role: "assistant",
            text: data.text,
          });
        }
        break;
      case "session.reasoning.delta":
        if (typeof data.delta === "string" && typeof data.assistantMessageID === "string") {
          const ordinal = typeof data.ordinal === "number" ? data.ordinal : 0;
          const id = `${data.assistantMessageID}:reason:${ordinal}`;
          const current = this.items.find((item) => item.id === id);
          const text = current && current.kind === "reasoning" ? current.text + data.delta : data.delta;
          this.items = upsertItem(this.items, {
            kind: "reasoning",
            id,
            text,
            streaming: true,
          });
        }
        break;
      case "session.tool.called":
        if (typeof data.id === "string") {
          this.items = upsertItem(this.items, {
            kind: "tool",
            id: `${data.assistantMessageID ?? "tool"}:${data.id}`,
            name: "tool",
            status: "running",
            input: typeof data.input === "string" ? data.input : JSON.stringify(data.input ?? {}),
            output: "",
          });
        }
        break;
      case "session.tool.success":
      case "session.tool.failed":
        void this.reloadTranscript();
        break;
      case "session.shell.started":
      case "session.shell.ended":
        void this.reloadTranscript();
        break;
      case "permission.asked":
        if (typeof data.id === "string" && sessionID) {
          this.approvals = [
            ...this.approvals.filter((item) => item.id !== data.id),
            {
              id: data.id,
              sessionID,
              action: typeof data.action === "string" ? data.action : "permission",
              resources: Array.isArray(data.resources)
                ? data.resources.filter((item): item is string => typeof item === "string")
                : [],
              message: typeof data.message === "string" ? data.message : undefined,
            },
          ];
          this.activity = reduceActivity(this.activity, { type: "approval" });
          if (readSettings().notifications) {
            void vscode.window.showInformationMessage("OpenCode Studio: 承認待ちの操作があります。");
          }
        }
        break;
      case "permission.replied":
        if (typeof data.requestID === "string") {
          this.approvals = this.approvals.filter((item) => item.id !== data.requestID);
          this.activity = reduceActivity(this.activity, { type: "approval-cleared" });
        }
        break;
      case "session.model.selected":
        if (
          sessionID === this.activeSessionID &&
          isRecord(data.model) &&
          typeof data.model.id === "string" &&
          typeof data.model.providerID === "string"
        ) {
          const label = `${data.model.providerID}/${data.model.id}`;
          this.selectedModel = label;
          this.selectedVariant = normalizeVariant(data.model.variant, this.variantsOf(label));
        }
        break;
      case "session.created":
      case "session.deleted":
      case "session.renamed":
        void this.reloadSessions();
        break;
      default:
        break;
    }
    this.publish();
  }

  private onStreamError(error: unknown): void {
    this.log(`stream error: ${errorText(error)}`);
    this.activity = reduceActivity(this.activity, {
      type: "disconnected",
      message: `イベントストリームが切断されました: ${errorText(error)}`,
    });
    this.publish();
  }

  private async reloadSessions(): Promise<void> {
    const client = this.connection.live?.client;
    if (!client) return;
    this.sessions = await listSessions(client, this.directory);
    this.publish();
  }

  private async reloadTranscript(): Promise<void> {
    const client = this.connection.live?.client;
    if (!client || !this.activeSessionID) return;
    this.items = await loadTranscript(client, this.activeSessionID);
    this.publish();
  }

  private async reloadDiffs(): Promise<void> {
    const client = this.connection.live?.client;
    if (!client || !this.activeSessionID) return;
    this.diffs = await loadDiffs(client, this.activeSessionID).catch(() => []);
    this.publish();
  }

  private requireClient(): OpenCodeClient | undefined {
    const client = this.connection.live?.client;
    if (!client) {
      this.fail("OpenCode に接続されていません。");
      return undefined;
    }
    return client;
  }

  private fail(message: string): void {
    this.activity = reduceActivity(this.activity, {
      type: "connect-failed",
      message,
    });
    this.log(message);
    this.publish();
  }

  private publish(): void {
    const snapshot = this.snapshot();
    for (const listener of this.listeners) listener(snapshot);
  }

  private log(message: string): void {
    if (readSettings().logLevel === "error" && !message.toLowerCase().includes("error") && !message.includes("失敗")) {
      return;
    }
    this.output.appendLine(`[${new Date().toISOString()}] ${message}`);
  }
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (isRecord(error) && typeof error.message === "string") return error.message;
  return "不明なエラー";
}
