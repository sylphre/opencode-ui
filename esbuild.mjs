// Copyright (C) 2014-2026 Laurier Sylph. All rights reserved.
import * as esbuild from "esbuild";
import { readFileSync, writeFileSync } from "node:fs";

const watch = process.argv.includes("--watch");

const extension = {
  banner: { js: "// Copyright (C) 2014-2026 Laurier Sylph. All rights reserved." },
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "dist/extension.js",
  external: ["vscode"],
  format: "cjs",
  platform: "node",
  target: "node20",
  sourcemap: true,
  logLevel: "info",
};

const webview = {
  banner: { js: "// Copyright (C) 2014-2026 Laurier Sylph. All rights reserved." },
  entryPoints: ["webview/index.tsx"],
  bundle: true,
  outfile: "dist/webview.js",
  format: "iife",
  platform: "browser",
  target: "es2022",
  jsx: "automatic",
  sourcemap: true,
  logLevel: "info",
  define: { "process.env.NODE_ENV": '"production"' },
};

function emitCss() {
  writeFileSync("dist/webview.css", readFileSync("webview/styles.css"));
}

if (watch) {
  const ctx1 = await esbuild.context(extension);
  const ctx2 = await esbuild.context(webview);
  emitCss();
  await ctx1.watch();
  await ctx2.watch();
} else {
  await esbuild.build(extension);
  await esbuild.build(webview);
  emitCss();
}
