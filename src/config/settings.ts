// Copyright (C) 2014-2026 Laurier Sylph. All rights reserved.
import * as vscode from "vscode";

export interface StudioSettings {
  executablePath: string;
  autoConnect: boolean;
  launchMode: "auto" | "attach";
  connectTimeoutMs: number;
  defaultAgent: string;
  defaultModel: string;
  notifications: boolean;
  logLevel: "error" | "info" | "debug";
}

export function readSettings(): StudioSettings {
  const config = vscode.workspace.getConfiguration("opencodeStudio");
  const launch = config.get<string>("launchMode", "auto");
  const level = config.get<string>("logLevel", "info");
  const timeout = config.get<number>("connectTimeoutMs", 20000);
  return {
    executablePath: config.get<string>("executablePath", "").trim(),
    autoConnect: config.get<boolean>("autoConnect", true),
    launchMode: launch === "attach" ? "attach" : "auto",
    connectTimeoutMs:
      typeof timeout === "number" && timeout >= 1000 && timeout <= 120000
        ? timeout
        : 20000,
    defaultAgent: config.get<string>("defaultAgent", "").trim(),
    defaultModel: config.get<string>("defaultModel", "").trim(),
    notifications: config.get<boolean>("notifications", true),
    logLevel: level === "debug" || level === "error" ? level : "info",
  };
}
