// Copyright (C) 2014-2026 Laurier Sylph. All rights reserved.
import { describe, expect, it } from "vitest";
import { initialActivity, reduceActivity } from "../../src/state/activity.js";

describe("activity", () => {
  it("does not treat a dropped stream as completion", () => {
    const running = reduceActivity(initialActivity(), { type: "execution-started" });
    const dropped = reduceActivity(running, {
      type: "disconnected",
      message: "stream ended",
    });
    expect(dropped.phase).toBe("disconnected");
    expect(dropped.phase).not.toBe("completed");
  });

  it("keeps cancelling while execution is still open", () => {
    let state = reduceActivity(initialActivity(), { type: "execution-started" });
    state = reduceActivity(state, { type: "cancel-requested" });
    state = reduceActivity(state, { type: "busy" });
    expect(state.phase).toBe("cancelling");
    state = reduceActivity(state, { type: "interrupted" });
    expect(state.phase).toBe("idle");
    expect(state.executionOpen).toBe(false);
  });

  it("marks approval separately from running", () => {
    let state = reduceActivity(initialActivity(), { type: "execution-started" });
    state = reduceActivity(state, { type: "approval" });
    expect(state.phase).toBe("awaitingApproval");
    state = reduceActivity(state, { type: "approval-cleared" });
    expect(state.phase).toBe("running");
  });

  it("records failure from the server event, not from silence", () => {
    const state = reduceActivity(reduceActivity(initialActivity(), { type: "busy" }), {
      type: "failed",
      message: "provider error",
    });
    expect(state.phase).toBe("failed");
    expect(state.detail).toBe("provider error");
  });

  it("ignores idle when already completed", () => {
    const done = reduceActivity(initialActivity(), { type: "succeeded" });
    expect(reduceActivity(done, { type: "idle" }).phase).toBe("completed");
  });
});
