# 検証記録 / 2026-10-31

## 合格

- TypeScript strict型チェック：`npm run typecheck`
- TypeScriptからfrontend/単一ESM Worker生成：`npm run build`
- Worker artifactのimportとfetch export検査：`npm run validate`
- 自動テスト19件：`npm test`
- D1の初回migrationをWranglerローカルDBへ適用：成功

## 自動テストが確認する範囲

NORMALは1回、OBSERVEは2回で介入なし、REFLECTは必要時のみ3回。再検討に初回回答と観察が渡ること、再検討上限1回、指摘なし・存在しない引用・空の依頼では再検討しないこと。観察/再検討の失敗時は初回回答を保持すること。不正な出力、範囲外の確信度、入力上限、履歴内のsystemロール、URL風モデルIDを拒否すること。

OpenAI adapterの送信形式、固定宛先、`store:false`、strict JSON Schema、refusal/incomplete、トークン集計。同一Originチェック、キー必須、サイズ上限、秘密情報を含めないエラー、CSP、静的アセット。D1未設定、保管庫token hash、実際のAES-GCMの往復と別鍵での復号失敗。

## 未検証・制限

- 実OpenAIキーは提供されていないため、課金を伴う実モデルE2Eは未実行。模擬Providerと模擬HTTPで制御/形式を確認した。
- ローカルpreviewは起動したが、ブラウザから `terminal.local:4173` への接続は `ERR_CONNECTION_REFUSED`。この経路でのPC/スマートフォン目視QAは未完了。
- 同モデル/異モデルにおける改善率、悪化率、引用の妥当性は実測していない。固定デモを能力の証明に使わない。
- 公開用のアクセス制御と保管庫作成時の割当制限はセルフホスト運用者が整備する。今回のSitesはowner-privateとして公開する。
- GitHub connectorは新規リポジトリ作成操作を提供していないため、ユーザー所有 `Masato-Nasu/MIRROR` の作成は未実施。接続したSites用ソースリポジトリへの同期とは別の操作。README/DEPLOYに新規GitHub公開コマンドを用意した。

## v0.1.1 修正

Cloudflare workerd環境で、OpenAI adapterがnative fetchをインスタンスメソッドとして呼び出すと `Illegal invocation` が発生し、OpenAIへ到達する前に502になる不具合を再現。関数をローカル変数に取り出してreceiverなしで呼び出すよう修正。Nodeの模擬fetchだけのテストで検出できなかったため、built Workerをworkerdに読み込み、ローカル上流stubを使って3モードの呼び出し数・再検討を確認する回帰テストを追加。実キーは使用しない。

Worker bundleのnamed exportから内部定数・クラスを除外し、default fetch exportだけを配信。ローカルworkerd対応の互換日付2026-10-30を使用。API認証・モデル・権限・残高・通信・タイムアウトを秘密情報を含めず区別表示する。

## v0.1.2 修正

観察AIの自由記述の引用が初回回答と完全一致せず、有効な指摘がすべて除外されて再検討が止まるケースに対応。初回回答の公開情報から引用候補を作り、観察用JSON Schemaのevidenceを候補のenumに制約する。生成時に実在する引用だけを選択させ、受信後の照合も維持する。追加API呼び出しは不要。介入を見送った場合の依頼表示も「見送った再検討案」に変更。主観的な質問で評価基準の確認だけを機械的に要求しないよう役割指示を調整。

## v0.2.0 画像入力

28件の自動テストが合格。対応形式とヘッダー照合、外部URL/SVG拒否、サイズ・枚数上限、過去の画像番号付けと欠落通知、初回認知・観察・再検討への同じ画像の引き渡し、input_imageパートとJSON本文の分離、応答への画像非混入を確認。workerdの3モード試験も画像付きリクエストに変更し、ローカル上流stubで送信形式と再検討を検証。実モデル画像認識の品質、端末ブラウザのファイル選択・canvas縮小操作は未検証。APIキーを使用した課金試験は行っていない。

## v0.3.0 回答品質

品質優先gpt-6.1-sol、最高品質gpt-6-astra、軽量gpt-4.1-miniを設定から選択可能。新規既定値はSol/high、既存のモデル指定は保持。推論low/medium/highを3段階すべてに渡し、GPT-6系だけにreasoning.effortを付与。出力予算はそれぞれ8000/16000/24000トークン、その他モデルは6000トークン、各API呼び出しの待機上限180秒。推論サマリーや暗号化思考の取得は要求しない。

追加テストで推論設定の検証・引き渡し・モデル別APIパラメーターを確認。workerd試験はSolとAstraの組み合わせ、画像付き、high設定でNORMAL/OBSERVE/REFLECTを確認する。実キーを用いた両モデルの利用可否・応答品質・料金・所要時間は未測定。改善を保証せず、A/B評価の枠組みを維持する。

2026-10-31確認の公式仕様：
- https://developers.openai.com/api/docs/models/gpt-6.1-sol
- https://developers.openai.com/api/docs/models/gpt-6-astra
- https://developers.openai.com/api/docs/guides/reasoning
- https://developers.openai.com/api/docs/guides/latest-model
