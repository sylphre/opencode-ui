// Copyright (C) 2014-2026 Laurier Sylph. All rights reserved.
import { OpenCode, type OpenCodeClient } from "@opencode/client";
import type { ChildProcess } from "node:child_process";
import {
  authHeader,
  processAlive,
  readRegistration,
  resolveExecutable,
  startService,
  toEndpoint,
  waitForRegistration,
  type ServiceEndpoint,
} from "./service.js";

export interface ConnectOptions {
  executablePath: string;
  launchMode: "auto" | "attach";
  timeoutMs: number;
  directory: string;
}

export interface LiveConnection {
  client: OpenCodeClient;
  endpoint: ServiceEndpoint;
  version: string;
  directory: string;
}

export class OpenCodeConnection {
  private child: ChildProcess | undefined;
  private current: LiveConnection | undefined;
  private abort: AbortController | undefined;

  get live(): LiveConnection | undefined {
    return this.current;
  }

  async connect(options: ConnectOptions): Promise<LiveConnection> {
    await this.closeStream();
    let registration = await readRegistration();
    if (!registration || !processAlive(registration.pid)) {
      if (options.launchMode === "attach") {
        throw new Error(
          "OpenCode サービスが見つかりません。先に `opencode serve` を起動するか、起動方法を auto にしてください。",
        );
      }
      const executable = await resolveExecutable(options.executablePath);
      this.child = startService(executable);
      registration = await waitForRegistration(options.timeoutMs);
    }
    const endpoint = toEndpoint(registration);
    const client = OpenCode.make({
      baseUrl: endpoint.url,
      headers: authHeader(endpoint),
    });
    const info = await client.server.info();
    if (!info || typeof info.version !== "string") {
      throw new Error("OpenCode のバージョンを確認できませんでした。");
    }
    this.current = {
      client,
      endpoint,
      version: info.version,
      directory: options.directory,
    };
    return this.current;
  }

  subscribe(
    onEvent: (event: { type?: string; data?: unknown }) => void,
    onError: (error: unknown) => void,
  ): void {
    const live = this.current;
    if (!live) return;
    this.abort?.abort();
    const abort = new AbortController();
    this.abort = abort;
    void this.pump(live.client, abort.signal, onEvent, onError);
  }

  async disconnect(): Promise<void> {
    await this.closeStream();
    this.current = undefined;
  }

  dispose(): void {
    void this.disconnect();
  }

  private async closeStream(): Promise<void> {
    this.abort?.abort();
    this.abort = undefined;
  }

  private async pump(
    client: OpenCodeClient,
    signal: AbortSignal,
    onEvent: (event: { type?: string; data?: unknown }) => void,
    onError: (error: unknown) => void,
  ): Promise<void> {
    try {
      const stream = await client.event.subscribe({ signal });
      for await (const event of stream) {
        if (signal.aborted) return;
        if (event && typeof event === "object") {
          onEvent(event as { type?: string; data?: unknown });
        }
      }
      if (!signal.aborted) onError(new Error("イベントストリームが終了しました"));
    } catch (error) {
      if (!signal.aborted) onError(error);
    }
  }
}
