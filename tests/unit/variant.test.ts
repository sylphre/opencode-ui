// Copyright (C) 2014-2026 Laurier Sylph. All rights reserved.
import { describe, expect, it } from "vitest";
import { normalizeVariant, resolveVariant } from "../../src/session/variant.js";

describe("normalizeVariant", () => {
  it("keeps a variant the model offers", () => {
    expect(normalizeVariant("high", ["low", "high", "max"])).toBe("high");
  });

  it("drops the session sentinel and unknown values", () => {
    expect(normalizeVariant("default", ["low", "high"])).toBeUndefined();
    expect(normalizeVariant("xhigh", ["low", "high"])).toBeUndefined();
    expect(normalizeVariant(undefined, ["low"])).toBeUndefined();
    expect(normalizeVariant(42, ["low"])).toBeUndefined();
  });
});

describe("resolveVariant", () => {
  const variants = ["low", "high", "max"];

  it("prefers the requested variant", () => {
    expect(resolveVariant(variants, "max", "low")).toBe("max");
  });

  it("clears on explicit default request", () => {
    expect(resolveVariant(variants, "default", "high")).toBeUndefined();
  });

  it("keeps a model's own variant named default", () => {
    expect(resolveVariant(["default", "high"], "default")).toBe("default");
  });

  it("carries the current variant over when the new model has it", () => {
    expect(resolveVariant(variants, undefined, "high")).toBe("high");
  });

  it("falls back to model default when the new model lacks it", () => {
    expect(resolveVariant(["low", "medium"], undefined, "max")).toBeUndefined();
    expect(resolveVariant([], "high", "high")).toBeUndefined();
  });
});
