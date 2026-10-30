// Copyright (C) 2014-2026 Laurier Sylph. All rights reserved.
import { spawn, type ChildProcess } from "node:child_process";
import { access } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export interface ServiceRegistration {
  url: string;
  pid: number;
  version?: string;
  password?: string;
}

export interface ServiceEndpoint {
  url: string;
  username: string;
  password?: string;
}

const USERNAME = "opencode";

export function registrationPath(): string {
  const state =
    process.env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state");
  return path.join(state, "opencode", "service.json");
}

export function parseRegistration(text: string): ServiceRegistration | undefined {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.url !== "string" || typeof record.pid !== "number") {
    return undefined;
  }
  return {
    url: record.url,
    pid: record.pid,
    version: typeof record.version === "string" ? record.version : undefined,
    password: typeof record.password === "string" ? record.password : undefined,
  };
}

export function toEndpoint(info: ServiceRegistration): ServiceEndpoint {
  return {
    url: info.url,
    username: USERNAME,
    password: info.password,
  };
}

export function authHeader(endpoint: ServiceEndpoint): Record<string, string> {
  if (!endpoint.password) return {};
  const token = Buffer.from(
    `${endpoint.username}:${endpoint.password}`,
  ).toString("base64");
  return { authorization: `Basic ${token}` };
}

export async function readRegistration(
  file = registrationPath(),
): Promise<ServiceRegistration | undefined> {
  try {
    const text = await readFile(file, "utf8");
    return parseRegistration(text);
  } catch {
    return undefined;
  }
}

export function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function resolveExecutable(configured: string): Promise<string> {
  const candidates = [
    configured,
    process.env.OPENCODE_BIN ?? "",
    path.join(os.homedir(), ".opencode", "bin", "opencode"),
    "opencode",
  ].filter((item) => item.length > 0);
  for (const candidate of candidates) {
    if (candidate === "opencode") return candidate;
    try {
      await access(candidate);
      return candidate;
    } catch {
      continue;
    }
  }
  return "opencode";
}

export async function waitForRegistration(
  timeoutMs: number,
  file = registrationPath(),
): Promise<ServiceRegistration> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const info = await readRegistration(file);
    if (info && processAlive(info.pid)) return info;
    await delay(250);
  }
  throw new Error(
    "OpenCode サービスが時間内に起動しませんでした。実行ファイルのパスとログを確認してください。",
  );
}

export function startService(executable: string): ChildProcess {
  const child = spawn(executable, ["serve", "--service"], {
    detached: true,
    stdio: "ignore",
    env: process.env,
  });
  child.unref();
  return child;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
