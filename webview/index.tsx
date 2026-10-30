// Copyright (C) 2014-2026 Laurier Sylph. All rights reserved.
import { Component, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { DEFAULT_VARIANT, type ChatItem, type HostToWebview, type StudioSnapshot, type WebviewToHost } from "../src/shared/protocol.js";
import { Markdown, CopyButton } from "./Markdown.js";

declare function acquireVsCodeApi(): {
  postMessage(message: WebviewToHost): void;
  getState(): StudioSnapshot | undefined;
  setState(state: StudioSnapshot): void;
};

const vscode = acquireVsCodeApi();

const empty: StudioSnapshot = {
  phase: "disconnected",
  detail: "未接続",
  recoverable: true,
  sessions: [],
  items: [],
  models: [],
  agents: [],
  diffs: [],
  approvals: [],
  contexts: [],
  planAvailable: false,
  buildAvailable: false,
};

function post(message: WebviewToHost): void {
  vscode.postMessage(message);
}

function App() {
  const [snapshot, setSnapshot] = useState<StudioSnapshot>(vscode.getState() ?? empty);
  const [draft, setDraft] = useState("");
  const [banner, setBanner] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [query, setQuery] = useState("");
  const followRef = useRef(true);
  const endRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const onMessage = (event: MessageEvent<HostToWebview>) => {
      const message = event.data;
      if (!message || typeof message !== "object") return;
      if (message.type === "snapshot") {
        setSnapshot(message.snapshot);
        vscode.setState(message.snapshot);
      } else if (message.type === "error") {
        setBanner(message.message);
      }
    };
    window.addEventListener("message", onMessage);
    post({ type: "ready" });
    return () => window.removeEventListener("message", onMessage);
  }, []);

  useEffect(() => {
    if (followRef.current) endRef.current?.scrollIntoView({ block: "end" });
  }, [snapshot.items, snapshot.phase]);

  useEffect(() => {
    followRef.current = true;
    endRef.current?.scrollIntoView({ block: "end" });
  }, [snapshot.activeSessionID]);

  const busy = useMemo(
    () => ["sending", "running", "awaitingApproval", "cancelling", "connecting"].includes(snapshot.phase),
    [snapshot.phase],
  );
  const offline = snapshot.phase === "disconnected" || snapshot.phase === "failed";
  const active = snapshot.sessions.find((session) => session.id === snapshot.activeSessionID);
  const mode = snapshot.selectedAgent === "plan" ? "plan" : "build";
  const currentModel = snapshot.models.find((model) => model.label === snapshot.selectedModel);
  const modelName = currentModel?.name ?? snapshot.selectedModel ?? "モデル";
  const variants = Array.isArray(currentModel?.variants) ? currentModel.variants : [];
  const filtered = snapshot.models.filter((model) => {
    const needle = query.trim().toLowerCase();
    if (!needle) return true;
    return model.name.toLowerCase().includes(needle) || model.label.toLowerCase().includes(needle);
  });

  const send = () => {
    const text = draft.trim();
    if (!text || busy || offline) return;
    setDraft("");
    if (boxRef.current) boxRef.current.style.height = "auto";
    post({ type: "send", text });
  };

  return (
    <div className="app" onKeyDown={(event) => {
      if (event.key === "Escape") { setModelOpen(false); setHistoryOpen(false); }
    }}>
      <header className="top">
        <button className="icon" title="セッション" onClick={() => setHistoryOpen((open) => !open)} aria-expanded={historyOpen}>
          ≡
        </button>
        <button className="session-pick" onClick={() => setHistoryOpen((open) => !open)}>
          <span className="brand">OPENCODE <span>STUDIO</span></span>
          <span className="session-title">{active?.title ?? "新しい会話"}</span>
        </button>
        <span className={`pulse ${snapshot.phase}`} role="status" title={`${label(snapshot.phase)}: ${snapshot.detail}`} aria-label={label(snapshot.phase)} />
        <button className="icon" title="新しいセッション" disabled={offline && snapshot.phase !== "failed"} onClick={() => post({ type: "newSession" })}>
          +
        </button>
        <button className="icon" title="エディターで開く" onClick={() => post({ type: "openPanel" })}>
          ↗
        </button>
        <button className="icon" title="設定" onClick={() => post({ type: "openSettings" })}>
          ⚙
        </button>
      </header>

      {historyOpen ? (
        <div className="drawer">
          {snapshot.sessions.length === 0 ? <div className="empty"><p>履歴はありません</p></div> : null}
          {snapshot.sessions.map((session) => (
            <div className="history-row" key={session.id}>
            <button
              className={session.id === snapshot.activeSessionID ? "history-select on" : "history-select"}
              onClick={() => {
                post({ type: "selectSession", sessionID: session.id });
                setHistoryOpen(false);
              }}
            >
              <span>{session.title}</span>
              <span className="sub">{[session.agent, session.model].filter(Boolean).join(" · ")}</span>
            </button>
            <button
              className="history-delete"
              aria-label={`「${session.title}」を削除`}
              title="会話を削除"
              onClick={() => post({ type: "deleteSession", sessionID: session.id })}
            >削除</button>
            </div>
          ))}
        </div>
      ) : null}

      <main className="thread" onScroll={(event) => {
        const el = event.currentTarget;
        followRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 64;
      }}>
        {banner ? <div className="alert" role="alert">{banner}<button className="text-btn" onClick={() => setBanner("")}>閉じる</button></div> : null}
        {snapshot.items.length === 0 ? (
          <div className="empty">
            <div className="welcome-mark" aria-hidden="true">&lt;/&gt;</div>
            <div className="eyebrow">YOUR WORKSPACE, YOUR AGENT</div>
            <h2>{snapshot.phase === "connecting" ? "接続しています" : offline ? "OpenCode に接続" : "次のアイデアを、コードに。"}</h2>
            <p>
              {offline
                ? snapshot.phase === "disconnected"
                  ? "ローカルの OpenCode に接続して作業を始めましょう。"
                  : snapshot.detail
                : "ワークスペースを読ませて、編集とコマンド実行まで任せられます。"}
            </p>
            {snapshot.phase === "connecting" ? <p>OpenCode を起動しています…</p> : null}
            {!offline && snapshot.phase !== "connecting" ? <div className="starters">
              {["このプロジェクトの構成を説明して", "改善できる点を調査して", "テストを確認して不足を補って"].map((text) =>
                <button key={text} onClick={() => { setDraft(text); boxRef.current?.focus(); }}>{text}<span aria-hidden="true">↗</span></button>)}
            </div> : null}
          </div>
        ) : (
          snapshot.items.map((item) => <Message key={item.id} item={item} />)
        )}
        <div ref={endRef} />
      </main>

      <footer className="dock">
        <div className="dock-panels">
        {snapshot.approvals.map((approval) => (
          <section key={approval.id} className="approval">
            <h3>承認が必要です · {approval.action}</h3>
            <div className="who">{approval.resources.join("\n") || approval.message}</div>
            <div className="actions">
              <button className="btn secondary" onClick={() => post({ type: "approve", requestID: approval.id, decision: "reject" })}>拒否</button>
              <button className="btn secondary" onClick={() => post({ type: "approve", requestID: approval.id, decision: "always" })}>常に許可</button>
              <button className="btn primary" onClick={() => post({ type: "approve", requestID: approval.id, decision: "once" })}>今回だけ許可</button>
            </div>
          </section>
        ))}
        {snapshot.diffs.length > 0 ? (
          <details className="changes">
            <summary>変更されたファイル <span className="count">{snapshot.diffs.length}</span></summary>
            {snapshot.diffs.map((diff) => (
              <button key={diff.file} className="file" onClick={() => post({ type: "openDiff", file: diff.file })}>
                <span>{diff.file}</span>
                <span className="add">+{diff.additions}</span>
                <span className="del">-{diff.deletions}</span>
              </button>
            ))}
            <div className="actions">
              <button className="btn secondary" onClick={() => post({ type: "revert" })}>スナップショットへ戻す</button>
            </div>
          </details>
        ) : null}
        </div>
        <div className="composer-card">
        {snapshot.contexts.length > 0 ? (
          <div className="chips">
            {snapshot.contexts.map((chip) => (
              <button key={chip.id} className="chip" onClick={() => post({ type: "removeContext", id: chip.id })}>
                {chip.label} ×
              </button>
            ))}
          </div>
        ) : null}
        <div className="composer">
          <textarea
            ref={boxRef}
            aria-label="メッセージ"
            rows={3}
            value={draft}
            placeholder={offline ? "接続してから入力" : "作りたいものや、調べたいことを書く…"}
            disabled={offline || snapshot.phase === "connecting"}
            onChange={(event) => {
              setDraft(event.target.value);
              event.target.style.height = "auto";
              event.target.style.height = `${Math.min(event.target.scrollHeight, 160)}px`;
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                send();
              }
            }}
          />
        </div>
        <div className="composer-tools">
          <button className="context-btn" title="開いているファイルを追加" onClick={() => post({ type: "addActiveFile" })}>＋ ファイル</button>
          <button className="context-btn" title="選択範囲を追加" onClick={() => post({ type: "addSelection" })}>選択範囲</button>
          <button className="context-btn" title="追加の指示ファイル / Build のベースシステムプロンプトを設定" onClick={() => post({ type: "configureInstructions" })}>指示設定</button>
          <span className="input-hint">Shift+Enter 改行</span>
          {busy && snapshot.phase !== "connecting" ? (
            <button className="send stop" aria-label="処理を停止" title="停止" disabled={snapshot.phase === "cancelling"} onClick={() => post({ type: "stop" })}>■</button>
          ) : (
            <button className="send" aria-label="メッセージを送信" title="送信" disabled={busy || offline || !draft.trim()} onClick={send}>↑</button>
          )}
        </div>
        {modelOpen ? (
           <div className="model-sheet" role="region" aria-label="モデル選択">
             <div className="sheet-heading">モデルを選択<button className="icon" aria-label="モデル選択を閉じる" onClick={() => setModelOpen(false)}>×</button></div>
            <input
              autoFocus
              aria-label="モデルを検索"
              placeholder="モデルを検索"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <div className="model-list">
              {filtered.length === 0 ? <div className="who">該当なし</div> : null}
              {filtered.map((model) => (
                <button
                  key={model.label}
                  className={model.label === snapshot.selectedModel ? "on" : ""}
                  onClick={() => {
                    post({ type: "setModel", providerID: model.providerID, modelID: model.id });
                    setModelOpen(false);
                    setQuery("");
                  }}
                >
                  <span>{model.name}</span>
                  <span className="sub">{model.providerID}{model.variants?.length ? ` · ${model.variants.join(" / ")}` : ""}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
        <div className="foot">
          <button
            className="mode-toggle"
            disabled={!snapshot.planAvailable || !snapshot.buildAvailable}
            title={mode === "plan" ? "Plan。クリックで Build" : "Build。クリックで Plan"}
            onClick={() => post({ type: "setMode", mode: mode === "plan" ? "build" : "plan" })}
          >
            {mode === "plan" ? "Plan" : "Build"}
          </button>
          <button
            className="model-btn"
            title={currentModel ? `${currentModel.providerID}/${currentModel.id}` : modelName}
            aria-expanded={modelOpen}
            onClick={() => setModelOpen((open) => !open)}
          >
            <span className="model-name">{modelName}</span>
            <span className="chev" aria-hidden="true">▾</span>
          </button>
          {currentModel && variants.length > 0 ? (
            <label className="variant-picker" title="推論の強さ">
              <span>推論</span>
              <select aria-label="推論の強さ" value={snapshot.selectedVariant ?? DEFAULT_VARIANT}
                onChange={(event) => post({ type: "setModel", providerID: currentModel.providerID, modelID: currentModel.id, variant: event.target.value })}>
                {[...(variants.includes(DEFAULT_VARIANT) ? [] : [DEFAULT_VARIANT]), ...variants].map((variant) =>
                  <option key={variant} value={variant}>{variant === DEFAULT_VARIANT ? "Auto" : variant}</option>)}
              </select>
            </label>
          ) : null}
        </div>
        </div>
        <div className="connection-status" role="status" title={snapshot.detail}>
          <span className={`pulse ${snapshot.phase}`} />
          <span className="status-text">{label(snapshot.phase)}{busy ? ` · ${snapshot.detail}` : ""}</span>
          {snapshot.phase === "failed" || snapshot.phase === "disconnected" ? (
            <button className="text-btn" onClick={() => post({ type: "connect" })}>再接続</button>
          ) : null}
        </div>
      </footer>
    </div>
  );
}

function Message({ item }: { item: ChatItem }) {
  if (item.kind === "text") {
    return (
      <article className={`msg ${item.role}`}>
        <div className="message-heading"><span className="who">{item.role === "user" ? "YOU" : "OPENCODE"}{item.streaming ? " · 応答中" : ""}</span><CopyButton text={item.text} /></div>
        <div className="bubble">{item.role === "assistant" ? <Markdown text={item.text} /> : item.text}</div>
      </article>
    );
  }
  if (item.kind === "reasoning") {
    return (
      <details className="fold">
        <summary>思考{item.streaming ? " · 進行中" : ""}</summary>
        <Markdown text={item.text} />
      </details>
    );
  }
  if (item.kind === "tool") {
    return (
      <details className="fold" open={item.status === "running" || item.status === "error"}>
        <summary>
          <span>{item.name}</span>
          <span className={`badge ${item.status === "error" ? "bad" : item.status === "completed" ? "ok" : "run"}`}>{item.status}</span>
        </summary>
        {item.input ? <pre>{item.input}</pre> : null}
        {item.output ? <pre>{item.output}</pre> : null}
      </details>
    );
  }
  if (item.kind === "shell") {
    return (
      <details className="fold" open={item.status === "running"}>
        <summary>
          <span>$ {item.command}</span>
          <span className={`badge ${item.status === "exited" && item.exit ? "bad" : "ok"}`}>{item.status}</span>
        </summary>
        {item.output ? <pre>{item.output}</pre> : null}
      </details>
    );
  }
  if (item.kind === "error") return <div className="alert">{item.message}</div>;
  return <div className="who">{item.message}</div>;
}

function label(phase: StudioSnapshot["phase"]): string {
  switch (phase) {
    case "disconnected": return "未接続";
    case "connecting": return "接続中";
    case "idle": return "待機中";
    case "sending": return "送信中";
    case "running": return "処理中";
    case "awaitingApproval": return "承認待ち";
    case "cancelling": return "停止処理中";
    case "completed": return "完了";
    case "failed": return "失敗";
  }
}

class CrashBoundary extends Component<{ children: ReactNode }, { message: string }> {
  state = { message: "" };

  static getDerivedStateFromError(error: unknown): { message: string } {
    return { message: error instanceof Error ? error.message : "画面を描画できません" };
  }

  render() {
    if (this.state.message) {
      return <div className="alert">{this.state.message}</div>;
    }
    return this.props.children;
  }
}

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <CrashBoundary>
      <App />
    </CrashBoundary>,
  );
}
