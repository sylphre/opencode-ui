// Copyright (C) 2014-2026 Laurier Sylph. All rights reserved.
import { describe, expect, it } from "vitest";
import { instructionPath, updateInstructionConfig } from "../../src/config/instructionConfig.js";
import { isWebviewMessage } from "../../src/shared/protocol.js";

describe("workspace instruction configuration", () => {
  it("appends instructions without losing other fields or existing remote/glob entries", () => {
    const source = { model: "test/model", instructions: ["docs/*.md", "https://example.com/rules", "./rules.md"], agents: { build: { system: "existing" } } };
    expect(JSON.parse(updateInstructionConfig(JSON.stringify(source), "instructions", ["./rules.md", "./team.md"]))).toEqual({
      ...source, instructions: [...source.instructions, "./team.md"],
    });
  });

  it("replaces only Build system and preserves agent options and additive instructions", () => {
    const source = { instructions: ["AGENTS.md"], agents: { build: { system: "old", permissions: [] }, plan: { description: "Plan" } }, custom: true };
    expect(JSON.parse(updateInstructionConfig(JSON.stringify(source), "system", ["./prompts/base.txt"]))).toEqual({
      ...source, agents: { ...source.agents, build: { ...source.agents.build, system: "{file:./prompts/base.txt}" } },
    });
  });

  it("creates native v2 configuration from an empty object", () => {
    expect(JSON.parse(updateInstructionConfig("{}", "system", ["./base.md"]))).toEqual({ agents: { build: { system: "{file:./base.md}" } } });
    expect(JSON.parse(updateInstructionConfig("{}", "instructions", ["./rules.md"]))).toEqual({ instructions: ["./rules.md"] });
  });

  it.each(["{", "// comment\n{}", "{\"model\":1,}", "[]", "null", "42"])("refuses invalid or unsupported JSON: %s", (source) => {
    expect(() => updateInstructionConfig(source, "instructions", ["./rules.md"])).toThrow();
  });

  it.each([null, "rules.md", {}, [42]])("refuses malformed existing instructions: %j", (instructions) => {
    expect(() => updateInstructionConfig(JSON.stringify({ instructions }), "instructions", ["./rules.md"])).toThrow();
  });

  it.each([{ agents: null }, { agents: [] }, { agents: { build: null } }, { agents: { build: "old" } }])("refuses malformed agents: %j", (config) => {
    expect(() => updateInstructionConfig(JSON.stringify(config), "system", ["./base.md"])).toThrow();
  });

  it("requires files and exactly one system prompt", () => {
    expect(() => updateInstructionConfig("{}", "instructions", [])).toThrow();
    expect(() => updateInstructionConfig("{}", "system", ["./a.md", "./b.md"])).toThrow();
    expect(() => updateInstructionConfig("{}", "system", ["./../outside.md"])).toThrow();
    expect(() => updateInstructionConfig("{}", "system", ["/absolute.md"])).toThrow();
  });
});

describe("instruction paths", () => {
  it("makes literal portable config-relative paths, including spaces and Unicode", () => {
    expect(instructionPath("/workspace", "/workspace/prompts/team rules.md")).toBe("./prompts/team rules.md");
    expect(instructionPath("/workspace", "/workspace/指示.md")).toBe("./指示.md");
  });

  it.each(["/workspace", "/workspace-other/rules.md", "/outside.md", "/workspace/../outside.md", "/workspace/{env:KEY}.md", "/workspace/*.md", "/workspace/[a].md", "/workspace/a\\b.md", "/workspace/a\nb.md"])("rejects unsafe or outside path: %s", (file) => {
    expect(() => instructionPath("/workspace", file)).toThrow();
  });
});

describe("instruction command protocol", () => {
  it("accepts only the payload-free configure message", () => {
    expect(isWebviewMessage({ type: "configureInstructions" })).toBe(true);
    expect(isWebviewMessage({ type: "configureInstructions", path: "outside" })).toBe(false);
  });
});
