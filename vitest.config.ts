// Copyright (C) 2014-2026 Laurier Sylph. All rights reserved.
import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: { jsx: "automatic" },
  test: {
    include: ["tests/unit/**/*.test.ts"],
  },
});
