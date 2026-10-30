// Copyright (C) 2014-2026 Laurier Sylph. All rights reserved.
import { describe, expect, it } from "vitest";
import { messageItems, parseDiffs, appendText } from "../../src/session/messages.js";
import { parseRegistration } from "../../src/opencode/service.js";

describe("message parsing", () => {
  it("ignores messages without a type", () => {
    expect(messageItems({})).toEqual([]);
    expect(messageItems(undefined)).toEqual([]);
    expect(messageItems({ id: "1" })).toEqual([]);
  });

  it("reads user and assistant parts without assuming shape", () => {
    expect(messageItems({ id: "u", type: "user", text: "hi" })).toEqual([
      { kind: "text", id: "u", role: "user", text: "hi" },
    ]);
    const items = messageItems({
      id: "a",
      type: "assistant",
      content: [
        { type: "text", text: "answer" },
        { type: "reasoning", text: "think" },
        {
          type: "tool",
          id: "t1",
          name: "read",
          state: { status: "completed", input: { path: "a.ts" }, content: [{ type: "text", text: "ok" }] },
        },
        { broken: true },
      ],
    });
    expect(items.map((item) => item.kind)).toEqual(["text", "reasoning", "tool"]);
  });

  it("drops invalid diffs", () => {
    expect(
      parseDiffs([
        { file: "a.ts", patch: "@@", additions: 1, deletions: 0, status: "modified" },
        { file: "b.ts" },
        null,
      ]),
    ).toEqual([
      { file: "a.ts", patch: "@@", additions: 1, deletions: 0, status: "modified" },
    ]);
  });

  it("appends stream deltas once per part id", () => {
    const once = appendText([], "m:text:0", "assistant", "hel");
    const twice = appendText(once, "m:text:0", "assistant", "lo");
    expect(twice).toHaveLength(1);
    expect(twice[0]).toMatchObject({ text: "hello", streaming: true });
  });
});

describe("service registration", () => {
  it("rejects incomplete registration files", () => {
    expect(parseRegistration("not-json")).toBeUndefined();
    expect(parseRegistration("{}")).toBeUndefined();
    expect(parseRegistration(JSON.stringify({ url: "http://127.0.0.1:1" }))).toBeUndefined();
  });

  it("reads url, pid, and password", () => {
    expect(
      parseRegistration(JSON.stringify({ url: "http://127.0.0.1:1", pid: 4, password: "secret", version: "2.2.1" })),
    ).toEqual({ url: "http://127.0.0.1:1", pid: 4, password: "secret", version: "2.2.1" });
  });
});
