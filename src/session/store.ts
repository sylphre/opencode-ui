// Copyright (C) 2014-2026 Laurier Sylph. All rights reserved.
import type { OpenCodeClient } from "@opencode/client";
import type {
  AgentChoice,
  ApprovalRequest,
  ChatItem,
  ContextChip,
  DiffFile,
  ModelChoice,
  SessionSummary,
} from "../shared/protocol.js";
import { isRecord, messageItems, parseDiffs } from "./messages.js";

export interface Catalog {
  models: ModelChoice[];
  agents: AgentChoice[];
  planAgent?: string;
  buildAgent?: string;
  /** provider/model label of the server default model, if any. */
  defaultModel?: string;
}

export async function loadCatalog(
  client: OpenCodeClient,
  directory: string,
): Promise<Catalog> {
  const location = { directory };
  const [models, agents, fallback] = await Promise.all([
    client.model.list({ location }),
    client.agent.list({ location }),
    client.model.default({ location }).catch(() => undefined),
  ]);
  const defaultInfo = fallback?.data;
  const defaultModel =
    defaultInfo && typeof defaultInfo.providerID === "string"
      ? `${defaultInfo.providerID}/${defaultInfo.modelID || defaultInfo.id}`
      : undefined;
  const modelChoices = Array.isArray(models?.data)
    ? models.data
        .filter((model) => model && model.enabled !== false && typeof model.id === "string")
        .map((model) => ({
          id: model.modelID || model.id,
          providerID: model.providerID,
          name: model.name,
          label: `${model.providerID}/${model.modelID || model.id}`,
          variants: Array.isArray(model.variants)
            ? model.variants
                .map((variant) => variant?.id)
                .filter((id): id is string => typeof id === "string" && id.length > 0)
            : [],
        }))
    : [];
  const agentChoices = Array.isArray(agents?.data)
    ? agents.data
        .filter((agent) => agent && typeof agent.id === "string")
        .map((agent) => ({
          id: agent.id,
          name: agent.name || agent.id,
          description: agent.description,
          mode: agent.mode,
          hidden: Boolean(agent.hidden),
        }))
    : [];
  const selectable = agentChoices.filter(
    (agent) =>
      !agent.hidden &&
      (agent.mode === "primary" || agent.mode === "all") &&
      agent.id !== "compaction" &&
      agent.id !== "title" &&
      agent.id !== "summary",
  );
  return {
    models: modelChoices,
    agents: agentChoices,
    planAgent: pickAgent(selectable, ["plan"]),
    buildAgent: pickAgent(selectable, ["build", "code"]),
    defaultModel,
  };
}

function pickAgent(agents: AgentChoice[], hints: string[]): string | undefined {
  const found = agents.find((agent) =>
    hints.some((hint) => agent.id.toLowerCase().includes(hint) || agent.name.toLowerCase().includes(hint)),
  );
  return found?.id;
}

export async function listSessions(
  client: OpenCodeClient,
  directory: string,
): Promise<SessionSummary[]> {
  const page = await client.session.list({
    directory,
    archived: false,
    limit: 50,
    order: "desc",
  });
  const rows = Array.isArray(page?.data) ? page.data : [];
  return rows
    .filter((row) => row && typeof row.id === "string")
    .map((row) => ({
      id: row.id,
      title: row.title?.trim() || "無題のセッション",
      agent: row.agent,
      model: row.model ? `${row.model.providerID}/${row.model.id}` : undefined,
      updated: row.time?.updated ?? row.time?.created ?? 0,
      outcome: row.outcome,
    }));
}

export async function loadTranscript(
  client: OpenCodeClient,
  sessionID: string,
): Promise<ChatItem[]> {
  const page = await client.message.list({ sessionID, limit: 200, order: "asc" });
  const rows = Array.isArray(page?.data) ? page.data : [];
  return rows.flatMap((row) => messageItems(row));
}

export async function loadDiffs(
  client: OpenCodeClient,
  sessionID: string,
): Promise<DiffFile[]> {
  const rows = await client.session.diff({ sessionID });
  return parseDiffs(rows);
}

export async function loadApprovals(
  client: OpenCodeClient,
  sessionID: string,
): Promise<ApprovalRequest[]> {
  const rows = await client.permission.list({ sessionID });
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    if (!isRecord(row) || typeof row.id !== "string") return [];
    return [
      {
        id: row.id,
        sessionID: typeof row.sessionID === "string" ? row.sessionID : sessionID,
        action: typeof row.action === "string" ? row.action : "permission",
        resources: Array.isArray(row.resources)
          ? row.resources.filter((item): item is string => typeof item === "string")
          : [],
        message: typeof row.message === "string" ? row.message : undefined,
      },
    ];
  });
}

export function contextBlock(contexts: ContextChip[]): string {
  if (contexts.length === 0) return "";
  return `${contexts.map((item) => item.text).join("\n\n")}\n\n`;
}
