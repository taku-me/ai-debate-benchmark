# AI Debate Benchmark

**ローカルLLM × ChatGPT の日本語会話能力ベンチマークツール**

新モデルがリリースされたとき、`config.json` を1行追記するだけで日本語性能を他モデルと比較できる。
副産物として、討論実行中のRAM・CPU負荷データも自動記録される。

## このツールのキモ

**討論能力を測りたいわけではない。**
「日本語で自然な会話が成立するか」を軸にしている。英語を混ぜずに答えられるか、前の発言に具体的に反応できるか、論点がぶれないか。ローカルモデルの日本語対応度を手軽にスクリーニングするためのツール。

加えて、複数のOllamaモデルを順番に処理することで**実質的な負荷試験**になる。
RAM ピーク値・CPU loadavg の推移がHTML上のグラフで確認できるので、「このマシンでどのモデルが何台同時に動くか」を把握するのにも使える。

## 構成

```
.
├── debate.mjs          # 1トピック討論CLI
├── benchmark.mjs       # 固定トピックセット一括実行
├── debate-to-html.mjs  # JSON → メッセージアプリ風HTML変換
├── lib.mjs             # 共有コア関数
├── monitor.mjs         # システム負荷サンプリングモジュール
├── config.json         # 参加者・ベンチマークトピック設定
└── results/            # アーカイブ（自動生成）
```

## クイックスタート

```bash
# 1トピック討論（3ラウンド）
node debate.mjs "AIは人間の仕事を奪うか"

# 審判あり・負荷監視あり・ファイル保存
node debate.mjs "リモートワークは生産性を上げるか" --rounds 3 --judge --monitor --output result.json

# HTML化して確認
node debate-to-html.mjs result.json --output result.html
```

## オプション一覧

| オプション | 説明 |
|-----------|------|
| `--rounds <n>` | ラウンド数（デフォルト: 3） |
| `--judge` | 全ターン終了後にChatGPTが日本語能力を3軸採点 |
| `--monitor` | 討論中のRAM・CPU使用率を2秒ごとに記録 |
| `--config <file>` | 参加者設定JSONファイル（デフォルト: config.json） |
| `--archive <dir>` | 結果をタイムスタンプ付きでアーカイブ |
| `--output <file>` | 結果をJSONファイルに保存（省略時はstdout） |

## ベンチマーク実行

```bash
# config.jsonの全トピックを一括実行（審判あり）
node benchmark.mjs

# オプション
node benchmark.mjs --rounds 2 --archive ./results --output results/summary.html

# 特定トピックのみ（0始まりインデックス）
node benchmark.mjs --topic 0
```

## 参加者の変更

`config.json` を編集するだけ。現在の設定:

```json
{
  "participants": [
    { "name": "ChatGPT", "type": "openclaw", "model": "gpt-5.3-codex" },
    { "name": "Llama3",  "type": "ollama",   "model": "llama3.1:8b" },
    { "name": "Mistral", "type": "ollama",   "model": "mistral-nemo" },
    { "name": "Qwen2.5", "type": "ollama",   "model": "qwen2.5:7b-instruct" },
    { "name": "Qwen3",   "type": "ollama",   "model": "qwen3:8b" }
  ],
  "benchmarkTopics": [
    "AIは人間の仕事を奪うか",
    "..."
  ]
}
```

新モデルを試す場合は `participants` に1行追記するだけ:
```json
{ "name": "Gemma3", "type": "ollama", "model": "gemma3:9b" }
```

## APIバックエンド

| 種別 | エンドポイント | 備考 |
|------|--------------|------|
| `type: "openclaw"` | `docker exec openclaw-portable openclaw agent ...` | ChatGPT Plus経由 |
| `type: "ollama"` | `http://localhost:11434/api/chat` | `keep_alive: 0` で即アンロード |

### Ollamaのメモリ管理

Ollamaモデルは1つずつ順番に実行し、レスポンス後に即アンロード（`keep_alive: 0`）。
討論終了時に全モデルを明示的にアンロードする（`cleanupOllama()`）。

- `keep_alive: 0` はリクエスト単位で安全（Ollamaが参照カウントで管理）
- 他のプロセスが同じモデルを使っていても実行中のリクエストを強制終了しない
- ただし「これから使おうとしているプロセス」との競合（TOCTOU）は防げないため、
  Ollama専有のバッチ処理として運用すること

## 審判モード（`--judge`）

全ターン終了後にChatGPTが3軸で採点。日本語の自然さを定量化する:

| 軸 | 説明 |
|----|------|
| `japanese_quality` | 日本語の自然さ・流暢さ（英語混入や不自然な表現はマイナス） |
| `topic_relevance` | 論点への応答精度（前の発言に具体的に反応できているか） |
| `argument_coherence` | 論理の一貫性（立場がぶれていないか） |

## 負荷監視モード（`--monitor`）

討論実行中のシステムリソースを2秒ごとにサンプリング:

- **RAM使用量** — OS全体の使用メモリ（GB）
- **CPU loadavg** — 1分平均のロードアベレージ
- **Ollamaロード済みモデル** — 各時点でロードされているモデルとそのサイズ
- **イベントマーカー** — 各スピーカーのターン開始/終了タイミング

HTML出力にChart.js製のグラフが追加され、「どのモデルの処理中にRAMが何GBまで上がったか」が可視化される。

```
実行例:
📊 監視完了: RAM peak 15.94GB / CPU load peak 2.41
```

## 出力JSON形式

```json
{
  "topic": "...",
  "startedAt": "...",
  "rounds": 3,
  "participants": [...],
  "turns": [
    {
      "turn": 1,
      "round": 1,
      "speaker": "ChatGPT",
      "content": "...",
      "timestamp": "..."
    }
  ],
  "judgment": {
    "evaluatedBy": "ChatGPT",
    "scores": {
      "Llama3": {
        "japanese_quality": 7,
        "topic_relevance": 6,
        "argument_coherence": 6,
        "comment": "..."
      }
    },
    "ranking": ["ChatGPT", "Qwen3", "Mistral"],
    "summary": "..."
  },
  "metrics": [
    { "ts": "...", "cpu_load": 1.23, "ram_used": 14.5, "ram_free": 1.5, "ram_total": 16.0, "ollama": [...], "event": "Llama3:start" }
  ],
  "metricsSummary": {
    "ram_peak_gb": 15.94,
    "ram_min_gb": 13.2,
    "cpu_load_peak": 2.41,
    "cpu_load_avg": 1.87,
    "sample_count": 42,
    "duration_sec": 84
  },
  "completedAt": "..."
}
```

## 制約・目安

| 項目 | 詳細 |
|------|------|
| 推奨ラウンド数 | 3〜5ラウンド |
| 技術的上限 | 約8〜9ラウンド（Ollamaコンテキスト上限 16,000トークン） |
| 1ラウンドの時間（5モデル） | 約5〜8分（ChatGPT:8秒 + 各Ollamaモデル:30〜90秒） |
| メモリ管理 | `keep_alive: 0` で即アンロード（複数モデル同時ロード防止） |

## 環境要件

- Node.js 22+
- Docker（OpenClaw稼働中）
- Ollama（localhost:11434）

## HTML出力の印刷・PDF対応

`debate-to-html.mjs` は `@media print` CSSを内蔵しており、ブラウザの「印刷→PDFに保存」で出力できる。

### 可読性の設計基準

以下の研究・標準に基づいて印刷CSSの可読性を設計・検証している。

| 基準 | 内容 | 出典 |
|------|------|------|
| コントラスト比 4.5:1 | 通常テキストの最小コントラスト（Level AA） | [WCAG 2.1 SC 1.4.3](https://www.w3.org/TR/WCAG21/#contrast-minimum) — W3C (2018) |
| コントラスト比 3:1 | 大テキスト（≥18pt or ≥14pt bold）の最小コントラスト | WCAG 2.1 SC 1.4.3 — W3C (2018) |
| 本文最小フォントサイズ 9pt | 印刷物の最低可読サイズ | Tinker, M.A. (1963). *Legibility of Print*. Iowa State University Press. |
| 本文推奨サイズ 10–12pt | 最も読みやすいフォントサイズ範囲 | Tinker (1963); Unger, G. & Burke, C. (2007). *Designing Type*. Laurence King Publishing. |
| 行間 1.2–1.5× | 最適な行間設定 | Tinker (1963); ISO 9241-303:2011 Ergonomics of human-system interaction §5.4 |

### 実装上のポイント

- バブル背景はCSS変数でなくスピーカー別クラス（`.spk-*`）で管理し、`@media print` で `!important` 上書き可能にしている（inline `style` のCSS変数は `!important` で上書き不可なため）
- スピーカーカラー（緑・紫・橙）は装飾的用途のみなのでWCAG SC 1.4.1の例外として扱う
- `beforeprint` / `afterprint` JSイベントで動的なインタラクティブ印刷にも対応

### 現在の評価結果

| チェック項目 | 結果 | コントラスト比 |
|---|---|---|
| 本文テキスト（`#111` on `#fff`） | ✅ WCAG AAA | 18.1:1 |
| 見出し（`#000` on `#f0f0f0`） | ✅ WCAG AAA | 16.7:1 |
| 補助テキスト・`#555` on `#fff` | ✅ WCAG AAA | 7.5:1 |
| タイムスタンプ（`#777` on `#f7f7f7`） | △ WCAG AA 大テキスト相当 | 3.9:1 |
| スピーカー名（カラー on `#f7f7f7`） | △ 装飾的用途・許容 | ~3:1 |
| ヘッダー位置 | ✅ 1ページ目冒頭 | — |
| メッセージ途中改ページ | ✅ `page-break-inside: avoid` | — |

## 改造計画

- [ ] Fish-Speech連携 — スピーカーごとに声を変えて読み上げ
- [ ] Remotion動画化 — アバター付き討論動画の自動生成
- [ ] Discord投稿 — 結果をDiscordに自動投稿
