// Copyright (C) 2014-2026 Laurier Sylph. All rights reserved.
import path from "node:path";

export type InstructionAction = "instructions" | "system";

export function instructionPath(root: string, file: string): string {
  const relative = path.posix.relative(root, file);
  if (!relative || relative === ".." || relative.startsWith("../") || path.posix.isAbsolute(relative)) {
    throw new Error("Choose an existing file inside the workspace root.");
  }
  if (/[\\{}\[\]*?!\r\n\0]/.test(relative)) {
    throw new Error("Instruction file paths cannot contain glob characters, braces, backslashes, or line breaks. Rename the file first.");
  }
  return `./${relative}`;
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function updateInstructionConfig(source: string, action: InstructionAction, files: string[]): string {
  let config: unknown;
  try {
    config = JSON.parse(source);
  } catch {
    throw new Error("opencode.json is not valid JSON. Fix it manually before configuring instruction files; nothing was overwritten.");
  }
  if (!object(config)) throw new Error("opencode.json must contain a JSON object.");
  if (!files.length || files.some((file) => !file.startsWith("./") || instructionPath("/", `/${file.slice(2)}`) !== file)) {
    throw new Error("Choose at least one valid workspace instruction file.");
  }
  if (action === "instructions") {
    const existing = config.instructions === undefined ? [] : config.instructions;
    if (!Array.isArray(existing) || existing.some((item) => typeof item !== "string")) {
      throw new Error("Existing instructions must be an array of strings. Fix opencode.json manually first.");
    }
    config.instructions = [...new Set([...existing, ...files])];
  } else {
    if (files.length !== 1) throw new Error("Choose exactly one Build system prompt file.");
    const agents = config.agents === undefined ? {} : config.agents;
    if (!object(agents)) throw new Error("Existing agents must be a JSON object. Edit opencode.json manually.");
    const build = agents.build === undefined ? {} : agents.build;
    if (!object(build)) throw new Error("Existing agents.build must be a JSON object. Edit opencode.json manually.");
    config.agents = { ...agents, build: { ...build, system: `{file:${files[0]}}` } };
  }
  return `${JSON.stringify(config, null, 2)}\n`;
}
