# 公開手順（Vercel）

パソコンが苦手でも、上から順にやれば30分ほどで公開できます。かかる費用は0円です（Claude APIの利用料だけ従量課金）。

## 0. 先に用意するもの

| もの | 取り方 | 必須？ |
|---|---|---|
| GitHubアカウント | このリポジトリがあるアカウントでOK | 必須 |
| Claude APIキー | [Claude Console](https://console.anthropic.com/) →「API Keys」→「Create Key」 | 任意（無くても簡易レポートで動く） |
| PageSpeed Insights APIキー | [Google Cloud Console](https://console.cloud.google.com/) で「PageSpeed Insights API」を有効化 →「認証情報」→「APIキーを作成」 | 推奨（無いと速度計測が失敗しやすい） |

> ⚠️ Claude Consoleの「Billing」→「Spend limits」で、**月の上限額（例：3,000円）を必ず設定**してください。使いすぎを防げます。

## 1. Vercelにログイン

1. [vercel.com](https://vercel.com/) を開き、「Sign Up」→「Continue with GitHub」
2. プランは「Hobby（無料）」を選ぶ

## 2. プロジェクトを作る

1. 「Add New…」→「Project」
2. リポジトリ一覧からこのリポジトリを「Import」
   - 出てこない場合は「Adjust GitHub App Permissions」から、このリポジトリへのアクセスを許可する
3. 「Framework Preset」が **Next.js** になっていることを確認（自動で選ばれます）
4. 「Root Directory」はそのまま（`./`）

## 3. 設定値（Environment Variables）を入れる

同じ画面の「Environment Variables」に、1つずつ入れて「Add」を押します。

| Name | Value |
|---|---|
| `ANTHROPIC_API_KEY` | Claude APIキー（`sk-ant-`で始まる文字） |
| `CLAUDE_MODEL` | `claude-opus-5-5`（品質重視）または `claude-haiku-5-5`（費用重視） |
| `PAGESPEED_API_KEY` | PageSpeedのAPIキー |
| `DAILY_AI_LIMIT` | `30`（1日のAIレポート上限。費用を抑えたいなら `10`） |

## 4. 公開する

1. 「Deploy」を押す（2〜3分で終わります）
2. 「Congratulations!」と出たら、表示されたURL（`〇〇.vercel.app`）を開く

## 5. 公開後の確認（5分）

- [ ] 自分の会社や知っている会社のURLで診断し、スコアが出る
- [ ] 「社長向けレポート」に「AI作成」の印が出る（出ない場合は、黄色い帯の理由を確認）
- [ ] 「PDFに入れる宛名・自社ロゴ・連絡先」を入れて、「印刷・PDF保存」でPDFが作れる
- [ ] スマホでもURLを開いて使える

うまくいかないときは、Vercelのプロジェクト画面 →「Logs」にエラーが出ています。そのまま貼ってもらえれば直します。

## 6. 設定を変えたいとき

Vercelのプロジェクト →「Settings」→「Environment Variables」で値を変え、「Deployments」→ 最新のものの「…」→「Redeploy」を押します。

GitHubのこのブランチ（または main）に変更をpushすると、自動で再公開されます。

## 7. 独自ドメイン（任意・年1,500円前後）

ドメインを買ったら、Vercelの「Settings」→「Domains」に入力し、表示された設定をドメイン会社の管理画面に入れます。

## メモ

- サーバーは東京（`hnd1`）に置く設定にしています（`vercel.json`）。日本のサイトを速く読み込めます。
- 利用回数の制限はサーバーのメモリで数えているため、利用者が増えると正確でなくなります。有料化の前に Upstash Redis などに置き換えます。
- 同僚や知人に使ってもらう前に、勤務先の副業規定を確認してください（PLAN.md の「リスクと対策」参照）。
