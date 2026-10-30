// Copyright (C) 2014-2026 Laurier Sylph. All rights reserved.
export type ConnectionPhase =
  | "disconnected"
  | "connecting"
  | "idle"
  | "sending"
  | "running"
  | "awaitingApproval"
  | "cancelling"
  | "completed"
  | "failed";

export interface SessionSummary {
  id: string;
  title: string;
  agent?: string;
  model?: string;
  updated: number;
  outcome?: "succeeded" | "failed" | "interrupted";
}

/** Webview sends this to clear the variant. OpenCode also stores it on sessions that never picked one. */
export const DEFAULT_VARIANT = "default";

export interface ModelChoice {
  id: string;
  providerID: string;
  name: string;
  label: string;
  variants: string[];
}

export interface AgentChoice {
  id: string;
  name: string;
  description?: string;
  mode: string;
  hidden: boolean;
}

export interface ChatText {
  kind: "text";
  id: string;
  role: "user" | "assistant";
  text: string;
  streaming?: boolean;
}

export interface ChatReasoning {
  kind: "reasoning";
  id: string;
  text: string;
  streaming?: boolean;
}

export interface ChatTool {
  kind: "tool";
  id: string;
  name: string;
  status: "streaming" | "running" | "completed" | "error";
  input: string;
  output: string;
}

export interface ChatShell {
  kind: "shell";
  id: string;
  command: string;
  status: string;
  output: string;
  exit?: number;
}

export interface ChatError {
  kind: "error";
  id: string;
  message: string;
}

export interface ChatNotice {
  kind: "notice";
  id: string;
  message: string;
}

export type ChatItem =
  | ChatText
  | ChatReasoning
  | ChatTool
  | ChatShell
  | ChatError
  | ChatNotice;

export interface DiffFile {
  file: string;
  patch: string;
  additions: number;
  deletions: number;
  status: "added" | "deleted" | "modified";
}

export interface ApprovalRequest {
  id: string;
  sessionID: string;
  action: string;
  resources: string[];
  message?: string;
}

export interface ContextChip {
  id: string;
  label: string;
  text: string;
}

export interface StudioSnapshot {
  phase: ConnectionPhase;
  detail: string;
  recoverable: boolean;
  version?: string;
  url?: string;
  sessions: SessionSummary[];
  activeSessionID?: string;
  items: ChatItem[];
  models: ModelChoice[];
  agents: AgentChoice[];
  selectedModel?: string;
  selectedVariant?: string;
  selectedAgent?: string;
  diffs: DiffFile[];
  approvals: ApprovalRequest[];
  contexts: ContextChip[];
  planAvailable: boolean;
  buildAvailable: boolean;
}

export type HostToWebview =
  | { type: "snapshot"; snapshot: StudioSnapshot }
  | { type: "error"; message: string };

export type WebviewToHost =
  | { type: "ready" }
  | { type: "connect" }
  | { type: "disconnect" }
  | { type: "newSession" }
  | { type: "selectSession"; sessionID: string }
  | { type: "renameSession"; sessionID: string; title: string }
  | { type: "deleteSession"; sessionID: string }
  | { type: "send"; text: string }
  | { type: "stop" }
  | { type: "setModel"; providerID: string; modelID: string; variant?: string }
  | { type: "setAgent"; agentID: string }
  | { type: "setMode"; mode: "plan" | "build" }
  | { type: "approve"; requestID: string; decision: "once" | "always" | "reject" }
  | { type: "openDiff"; file: string }
  | { type: "revert" }
  | { type: "addActiveFile" }
  | { type: "addSelection" }
  | { type: "removeContext"; id: string }
  | { type: "openPanel" }
  | { type: "configureInstructions" }
  | { type: "openSettings" };

export function isWebviewMessage(value: unknown): value is WebviewToHost {
  if (!value || typeof value !== "object") return false;
  const type = (value as { type?: unknown }).type;
  if (type === "configureInstructions") return Object.keys(value).length === 1;
  return typeof type === "string";
}
