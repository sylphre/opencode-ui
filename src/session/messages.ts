// Copyright (C) 2014-2026 Laurier Sylph. All rights reserved.
import type {
  ChatItem,
  ChatTool,
  DiffFile,
} from "../shared/protocol.js";

interface TextPart {
  type: "text";
  text?: unknown;
}

interface ToolPart {
  type: "tool";
  id?: unknown;
  name?: unknown;
  state?: {
    status?: unknown;
    input?: unknown;
    content?: unknown;
    error?: { message?: unknown };
  };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function messageItems(message: unknown): ChatItem[] {
  if (!isRecord(message) || typeof message.type !== "string") return [];
  const id = typeof message.id === "string" ? message.id : "unknown";
  switch (message.type) {
    case "user":
      return [
        {
          kind: "text",
          id,
          role: "user",
          text: typeof message.text === "string" ? message.text : "",
        },
      ];
    case "assistant":
      return assistantItems(id, message.content);
    case "shell":
      return [
        {
          kind: "shell",
          id,
          command: typeof message.command === "string" ? message.command : "",
          status: typeof message.status === "string" ? message.status : "unknown",
          output: shellOutput(message.output),
          exit: typeof message.exit === "number" ? message.exit : undefined,
        },
      ];
    case "idle": {
      const outcome = typeof message.outcome === "string" ? message.outcome : "";
      if (outcome === "failed") {
        const error = isRecord(message.error) ? message.error.message : undefined;
        return [
          {
            kind: "error",
            id,
            message: typeof error === "string" ? error : "処理に失敗しました",
          },
        ];
      }
      if (outcome === "interrupted") {
        return [{ kind: "notice", id, message: "処理を停止しました" }];
      }
      return [];
    }
    default:
      return [];
  }
}

function assistantItems(id: string, content: unknown): ChatItem[] {
  if (!Array.isArray(content)) return [];
  const items: ChatItem[] = [];
  content.forEach((part, index) => {
    if (!isRecord(part) || typeof part.type !== "string") return;
    if (part.type === "text") {
      const text = (part as unknown as TextPart).text;
      if (typeof text === "string" && text.length > 0) {
        items.push({
          kind: "text",
          id: `${id}:text:${index}`,
          role: "assistant",
          text,
        });
      }
    } else if (part.type === "reasoning") {
      const text = part.text;
      if (typeof text === "string" && text.length > 0) {
        items.push({
          kind: "reasoning",
          id: `${id}:reason:${index}`,
          text,
        });
      }
    } else if (part.type === "tool") {
      items.push(toolItem(id, part as unknown as ToolPart, index));
    }
  });
  return items;
}

function toolItem(messageID: string, part: ToolPart, index: number): ChatTool {
  const status = part.state?.status;
  const toolStatus =
    status === "streaming" ||
    status === "running" ||
    status === "completed" ||
    status === "error"
      ? status
      : "running";
  return {
    kind: "tool",
    id:
      typeof part.id === "string" ? `${messageID}:${part.id}` : `${messageID}:tool:${index}`,
    name: typeof part.name === "string" ? part.name : "tool",
    status: toolStatus,
    input: stringify(part.state?.input),
    output:
      toolStatus === "error"
        ? typeof part.state?.error?.message === "string"
          ? part.state.error.message
          : "ツールが失敗しました"
        : toolContent(part.state?.content),
  };
}

function toolContent(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .map((item) => {
      if (!isRecord(item)) return "";
      if (item.type === "text" && typeof item.text === "string") return item.text;
      if (item.type === "file" && typeof item.uri === "string") return item.uri;
      return "";
    })
    .filter((line) => line.length > 0)
    .join("\n");
}

function shellOutput(output: unknown): string {
  if (!isRecord(output) || typeof output.output !== "string") return "";
  return output.output;
}

function stringify(value: unknown): string {
  if (value === undefined) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "";
  }
}

export function parseDiffs(value: unknown): DiffFile[] {
  if (!Array.isArray(value)) return [];
  const diffs: DiffFile[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.file !== "string" || typeof item.patch !== "string") {
      continue;
    }
    const status = item.status;
    if (status !== "added" && status !== "deleted" && status !== "modified") continue;
    diffs.push({
      file: item.file,
      patch: item.patch,
      additions: typeof item.additions === "number" ? item.additions : 0,
      deletions: typeof item.deletions === "number" ? item.deletions : 0,
      status,
    });
  }
  return diffs;
}

export function upsertItem(items: ChatItem[], next: ChatItem): ChatItem[] {
  const index = items.findIndex((item) => item.id === next.id);
  if (index < 0) return [...items, next];
  const copy = items.slice();
  copy[index] = next;
  return copy;
}

export function appendText(
  items: ChatItem[],
  id: string,
  role: "assistant",
  delta: string,
): ChatItem[] {
  const index = items.findIndex((item) => item.id === id);
  if (index < 0) {
    return [...items, { kind: "text", id, role, text: delta, streaming: true }];
  }
  const current = items[index];
  if (!current || current.kind !== "text") return items;
  const copy = items.slice();
  copy[index] = { ...current, text: current.text + delta, streaming: true };
  return copy;
}
