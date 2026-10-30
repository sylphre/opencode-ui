// Copyright (C) 2014-2026 Laurier Sylph. All rights reserved.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Markdown } from "../../webview/Markdown.js";

const render = (text: string) => renderToStaticMarkup(createElement(Markdown, { text }));

describe("chat Markdown", () => {
  it("renders headings, lists, tables and task lists", () => {
    const html = render("# Heading\n\n- **bold**\n- [x] complete\n\n| A | B |\n| - | - |\n| 1 | 2 |");
    expect(html).toContain("<h1>Heading</h1>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<table>");
    expect(html).toContain('type="checkbox"');
  });
  it("highlights code and provides copy controls", () => {
    const html = render("```js\nconst n = 1;\n```\n\n`inline`");
    expect(html).toContain("hljs-keyword");
    expect(html).toContain("copy-btn");
    expect(html).toContain("<code>inline</code>");
  });
  it("escapes code and rejects active HTML and unsafe links", () => {
    const html = render('<script>alert(1)</script>\n\n[x](javascript:alert)\n\n```html\n<img src=x onerror=alert(1)>\n```');
    expect(html).not.toContain("<script");
    expect(html).not.toContain('href="javascript:');
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;");
  });
  it("handles partial streaming code and unknown languages", () => {
    expect(render("```unknownlang\n<unfinished")).toContain("&lt;unfinished");
    expect(render("```\nplain\n```")).toContain("code-toolbar");
  });
});
