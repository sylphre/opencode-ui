# OpenCode Studio 設計メモ

対象はローカル OpenCode **v2.2.1**（`~/.opencode/bin/opencode`）。v1 の `@opencode-ai/sdk` と HTTP パスは使わない。

## 接続

- バックグラウンドサービスは `~/.local/state/opencode/service.json` に `{ url, pid, password, version }` を書く。
- 未起動なら `opencode serve --service` を起動し、登録ファイルが出るまで待つ。既に互換バージョンが healthy なら再利用する。
- 認証は HTTP Basic。ユーザー名は `opencode`、パスワードは登録ファイル。SecretStorage には置かない（プロセス所有の秘密）。
- クライアントは `@opencode/client` 2.2.1 の `OpenCode.make({ baseUrl, headers })`。
- ヘルス確認は `client.server.info()`。

## セッションとストリーム

- 作成: `session.create({ title, location: { directory }, agent })`
- 一覧: `session.list({ directory, archived: false })` → `{ data, cursor }`
- 履歴: `message.list({ sessionID })` → `SessionMessageInfo[]`
- 送信: `session.prompt({ sessionID, text })` は inbox 受付のみ。応答はイベント。
- 停止: `session.interrupt({ sessionID })`。戻り値の `interrupted` が真のときだけ停止済み。
- 削除・改名: `session.remove` / `session.update`
- モデル・エージェント: `session.switchModel` / `session.switchAgent`
- 差分: `session.diff({ sessionID })` → `FileDiffInfo[]`（patch / additions / deletions / status）
- 承認: `permission.asked` と `permission.list`。返答は `permission.reply({ decision: "once" | "always" | "reject" })`
- イベント: `event.subscribe()` の AsyncIterable。`server.connected` のあとバスイベント。

処理状態は次のイベントから導出する。推測で完了にしない。

| イベント | UI 状態 |
| --- | --- |
| `session.execution.started` / `session.status` busy | Running |
| `permission.asked` | AwaitingApproval |
| interrupt 要求後、まだ busy | Cancelling |
| `session.execution.succeeded` / `session.idle` outcome succeeded | Completed → Idle |
| `session.execution.failed` / idle failed | Failed |
| `session.execution.interrupted` | Idle（中断） |
| 切断 | Disconnected |

## モード

v2 の Plan / Build は専用フラグではなく primary エージェント。UI は `mode` が `primary` または `all` のエージェントだけを切り替え、名前に plan / build を含むものを優先する。該当が無いときは「利用不可」と表示する。

## 差分の採用・却下

OpenCode は編集をワークスペースへ直接書く。却下は `session.revert.stage` → `session.revert.commit`（スナップショットがある場合のみ）。競合時は API エラーを表示し、上書きしない。

## 未実装（UI に出さない）

音声、実験的 PTY WebSocket、ワークツリー作成、OAuth 接続ウィザード、VS Code Extension Host の自動統合テスト。
