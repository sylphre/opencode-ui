// Copyright (C) 2014-2026 Laurier Sylph. All rights reserved.
import type { ConnectionPhase } from "../shared/protocol.js";

export interface ActivityState {
  phase: ConnectionPhase;
  detail: string;
  recoverable: boolean;
  cancelRequested: boolean;
  executionOpen: boolean;
}

export function initialActivity(): ActivityState {
  return {
    phase: "disconnected",
    detail: "未接続",
    recoverable: true,
    cancelRequested: false,
    executionOpen: false,
  };
}

export type ActivityEvent =
  | { type: "connect-start" }
  | { type: "connected" }
  | { type: "connect-failed"; message: string }
  | { type: "disconnected"; message?: string }
  | { type: "sending" }
  | { type: "send-accepted" }
  | { type: "send-failed"; message: string }
  | { type: "execution-started" }
  | { type: "busy" }
  | { type: "approval" }
  | { type: "approval-cleared" }
  | { type: "cancel-requested" }
  | { type: "succeeded" }
  | { type: "failed"; message: string }
  | { type: "interrupted" }
  | { type: "idle" };

export function reduceActivity(
  state: ActivityState,
  event: ActivityEvent,
): ActivityState {
  switch (event.type) {
    case "connect-start":
      return {
        phase: "connecting",
        detail: "OpenCode に接続しています",
        recoverable: true,
        cancelRequested: false,
        executionOpen: false,
      };
    case "connected":
      return {
        phase: "idle",
        detail: "待機中",
        recoverable: true,
        cancelRequested: false,
        executionOpen: false,
      };
    case "connect-failed":
      return {
        phase: "failed",
        detail: event.message,
        recoverable: true,
        cancelRequested: false,
        executionOpen: false,
      };
    case "disconnected":
      return {
        phase: "disconnected",
        detail: event.message ?? "切断されました",
        recoverable: true,
        cancelRequested: false,
        executionOpen: false,
      };
    case "sending":
      return { ...state, phase: "sending", detail: "送信しています" };
    case "send-accepted":
      if (state.executionOpen) return state;
      return { ...state, phase: "running", detail: "エージェントが処理しています" };
    case "send-failed":
      return {
        ...state,
        phase: "failed",
        detail: event.message,
        recoverable: true,
      };
    case "execution-started":
    case "busy":
      if (state.cancelRequested) {
        return {
          ...state,
          phase: "cancelling",
          detail: "停止を要求しました。処理はまだ続いています",
          executionOpen: true,
        };
      }
      return {
        ...state,
        phase: "running",
        detail: "エージェントが処理しています",
        executionOpen: true,
      };
    case "approval":
      return {
        ...state,
        phase: "awaitingApproval",
        detail: "承認待ちです",
        executionOpen: true,
      };
    case "approval-cleared":
      if (state.phase !== "awaitingApproval") return state;
      return state.cancelRequested
        ? {
            ...state,
            phase: "cancelling",
            detail: "停止を要求しました。処理はまだ続いています",
          }
        : {
            ...state,
            phase: "running",
            detail: "エージェントが処理しています",
          };
    case "cancel-requested":
      return {
        ...state,
        cancelRequested: true,
        phase: "cancelling",
        detail: "停止を要求しています",
      };
    case "succeeded":
      return {
        phase: "completed",
        detail: "完了",
        recoverable: true,
        cancelRequested: false,
        executionOpen: false,
      };
    case "failed":
      return {
        phase: "failed",
        detail: event.message,
        recoverable: true,
        cancelRequested: false,
        executionOpen: false,
      };
    case "interrupted":
      return {
        phase: "idle",
        detail: "停止しました",
        recoverable: true,
        cancelRequested: false,
        executionOpen: false,
      };
    case "idle":
      if (state.executionOpen || state.phase === "running" || state.phase === "cancelling") {
        return {
          phase: "idle",
          detail: state.cancelRequested ? "停止しました" : "待機中",
          recoverable: true,
          cancelRequested: false,
          executionOpen: false,
        };
      }
      if (state.phase === "completed" || state.phase === "failed") return state;
      return {
        ...state,
        phase: "idle",
        detail: "待機中",
        executionOpen: false,
      };
    default:
      return state;
  }
}
