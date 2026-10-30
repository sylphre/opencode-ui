# OpenCode Studio

ローカルの OpenCode v2 に接続する VS Code 拡張です。OpenCode の Web UI は埋め込みません。

## 必要環境

- Ubuntu
- VS Code 1.95 以降
- OpenCode **2.x**（`opencode --version` が `v2` であること）
- ワークスペースを開いていること

OpenCode 1 の `opencode serve`（ポート 4096、`@opencode-ai/sdk`）には対応していません。

## インストール

```bash
npm install
npm run package
code --install-extension opencode-studio-0.1.0.vsix
```

## 使い方

1. Activity Bar の OpenCode Studio を開く。
2. 「接続」を押す。既定では `~/.local/state/opencode/service.json` のサービスを使い、無ければ `opencode serve --service` を起動する。
3. 「新規」でセッションを作り、メッセージを送る。Ctrl/Cmd+Enter でも送信できる。
4. 処理状態は OpenCode の実行イベントに従う。停止は `session.interrupt` の結果が出るまで「停止処理中」のまま。
5. 変更一覧から差分を開く。スナップショットがある場合だけ「スナップショットへ戻す」が効く。無い変更はワークスペースに残る。
6. 承認待ちは「一度だけ / 常に許可 / 拒否」。
7. 「パネル」でエディター側に同じセッションを開く。状態は共有される。

コマンドパレット: Connect、New Session、Stop、Open Chat Panel、Add Active File、Add Selection。

## 設定

`opencodeStudio.executablePath`、`autoConnect`、`launchMode`（`auto` または `attach`）、`connectTimeoutMs`、`defaultAgent`、`defaultModel`、`notifications`、`logLevel`。

認証パスワードは OpenCode の service.json にあり、拡張はログや Webview に出さない。

## トラブルシューティング

- **未接続のまま**: Output の「OpenCode Studio」を見る。バイナリパスが v2 か確認する。
- **認証エラー**: 既存サービスの `service.json` が読めない、または別プロセスがポートを占有している。`opencode service status` を確認する。
- **停止したように見えない**: interrupt が `interrupted: false` の間は処理中。ボタンを押しただけでは完了にしない。
- **Plan / Build が無効**: primary エージェント名に plan / build が無い。エージェント一覧から直接選ぶ。

## 制約

音声、PTY の対話端末、ワークツリー作成、プロバイダー OAuth ウィザードは未実装。差分プレビューはパッチの追加行を表示するもので、適用済みファイルそのものの VS Code SCM 差分ではない。安全な却下は OpenCode の revert API があるときだけ。
