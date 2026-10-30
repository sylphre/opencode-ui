// Copyright (C) 2014-2026 Laurier Sylph. All rights reserved.
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import hljs from "highlight.js/lib/common";

export function CopyButton({ text }: { text: string }) {
  const [status, setStatus] = useState("コピー");
  return <button className="copy-btn" onClick={async () => {
    try {
      await navigator.clipboard.writeText(text);
      setStatus("コピー済み");
    } catch {
      setStatus("コピー失敗");
    }
  }} aria-label={status} title={status}>{status}</button>;
}

export function Markdown({ text }: { text: string }) {
  return <div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={{
    // Remote images are deliberately rendered as links to avoid unsolicited requests.
    img: ({ src, alt }) => <a href={src} target="_blank" rel="noreferrer">{alt || "画像を開く"}</a>,
    a: ({ children, href }) => <a href={href} target="_blank" rel="noreferrer">{children}</a>,
    pre: ({ children }) => <div className="code-block">{children}</div>,
    code: ({ children, className, node }) => {
      const text = String(children);
      const language = /language-([\w+-]+)/.exec(className ?? "")?.[1];
      const block = Boolean(language) || text.endsWith("\n") || (node?.position?.start.line !== node?.position?.end.line);
      if (!block) return <code>{children}</code>;
      const source = text.replace(/\n$/, "");
      // Only highlight.js output enters innerHTML. It escapes the source first.
      const html = language && hljs.getLanguage(language)
        ? hljs.highlight(source, { language, ignoreIllegals: true }).value
        : undefined;
      return <>
        <div className="code-toolbar"><span>{language ?? "text"}</span><CopyButton text={source} /></div>
        <pre>{html === undefined ? <code>{source}</code> : <code dangerouslySetInnerHTML={{ __html: html }} />}</pre>
      </>;
    },
    table: ({ children }) => <div className="table-scroll"><table>{children}</table></div>,
  }}>{text}</ReactMarkdown></div>;
}
