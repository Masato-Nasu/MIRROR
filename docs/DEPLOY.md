# Cloudflare / GitHub セルフホスト手順

## 新しいGitHubリポジトリ

このフォルダのコードだけを新規 `MIRROR` に置きます。既存MASATO LABのリポジトリ内では実行しないでください。GitHub CLIの認証済み環境で：

```bash
git init -b main
git add .
git commit -m "MIRROR v0.1: add a second cognitive level"
gh repo create Masato-Nasu/MIRROR --public --source=. --remote=github --push
```

別の所有者で公開する場合は `Masato-Nasu` を自分のユーザー名に変更します。既存の `MIRROR` がある場合はcreateを繰り返さず、リポジトリを確認してください。Sitesのcheckoutを使う場合はすでにgit初期化されています。`git init` 以降のローカル準備は不要で、`gh repo create ... --source=. --remote=github --push` のみで新しいリモートに送れます。`.openai/hosting.json` はSites専用です。セルフホストでは使用しません。

## 推奨：Pages + Functions

Node 24.10以上を用意します。

```bash
npm ci
npm run typecheck
npm run build
npm test
npx wrangler login
npx wrangler d1 create mirror-vault
```

返ったdatabase_idを `wrangler.pages.jsonc` の `REPLACE_WITH_YOUR_D1_ID` に設定。新しいプロジェクト名 `mirror` を使用します。既存アプリ名は指定しません。

```bash
npx wrangler d1 migrations apply mirror-vault --remote --config wrangler.pages.jsonc
npx wrangler pages project create mirror --production-branch main
npx wrangler pages deploy public --config wrangler.pages.jsonc --project-name mirror --branch main
```

`mirror` が他の用途で使われている場合は、設定とコマンドの両方を新しい固有名に変更します。`functions/[[path]].ts` がWorker backendとしてバンドルされます。`public/_routes.json` で `/api/*` のみFunctionsに渡し、その他はPages配信です。フロントとAPIが同じOriginになるため、CORS許可の追加は不要です。

D1を使わない場合、設定から `d1_databases` を削除し、D1コマンドを省略します。その場合、保管庫だけが未設定エラーになり、会話は使用可能です。

## 代替：Workers単体

`wrangler.jsonc` に新しいD1 IDを設定し：

```bash
npm run build
npx wrangler d1 migrations apply mirror-vault --remote
npx wrangler deploy
```

アセットを内包する同じWorkerを公開します。PagesとWorkersの両方を同時に公開する必要はありません。D1のmigrationは一方の方式でのみ適用してください。

## ローカル確認

Workers方式：

```bash
npm run build
npx wrangler d1 migrations apply mirror-vault --local
npm run dev
```

Pages方式：

```bash
npm run build
npx wrangler d1 migrations apply mirror-vault --local --config wrangler.pages.jsonc
npx wrangler pages dev public --config wrangler.pages.jsonc
```

ブラウザで接続し、設定欄にOpenAI APIキーを入力します。キーを `.env` やソースに書く必要はありません。ブラウザを閉じるか再読み込みすると入力し直します。

## 公開時のアクセスと運用

初期版はセルフホスト・限定利用を想定しています。D1保管庫はランダム復元コードの所持で認可しますが、アカウント登録や新規保管庫作成数の上限は実装しません。自分用にはCloudflare Accessなどでサイト全体を保護してください。不特定多数へ開放する場合は、保管庫作成の認証・レート制限・容量割当を追加してから運用してください。APIキーを運営側から供給するコードはありません。

Workers設定ではobservabilityをオフにしています。Pagesを含め、ダッシュボードのログ・Logpush・外部監視にAuthorizationやリクエスト本文を記録する設定を追加しないでください。必要な障害ログは経路・状態コードなどに限定します。APIキーが一度漏れた場合はOpenAIで失効し、新しいキーを使います。

## 公開後の動作確認

1. `/api/health` の `ok` がtrue、D1設定済みなら `vault` がtrue。
2. APIキーなしで「動作例」が表示され、実AIとの混同がない。
3. キーを設定しNORMAL、OBSERVE、REFLECTそれぞれで会話。
4. REFLECTが常に介入するわけではなく、OBSERVEは回答を変更しないことを確認。
5. 記録削除、任意の端末保存、リロード後のキー消失を確認。
6. 復元コードを控え、暗号化保存→復元→D1削除を確認。
7. モバイルでタブ・入力・設定ダイアログを確認。

## 公式資料（2026-10-31確認）

- https://developers.cloudflare.com/pages/functions/wrangler-configuration/
- https://developers.cloudflare.com/pages/functions/bindings/
- https://developers.cloudflare.com/d1/reference/migrations/
- https://developers.cloudflare.com/workers/wrangler/commands/pages/

## Public β safeguards

Apply both `0000_vaults` and `0001_public_beta_limits` before deploying this version. Sites applies committed Drizzle migrations during publication. Standalone Workers/Pages use the matching SQL in `migrations/`. Missing abuse-limit tables fail closed: vault requests cannot silently bypass limits. See SECURITY.md for quotas. Keep provider Authorization and request bodies out of hosting logs and monitoring.
