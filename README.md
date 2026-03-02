# AI Debate Benchmark

複数のAIモデルが日本語で討論し、日本語会話能力をベンチマーク評価するツール。

新しいモデルがリリースされたときに `config.json` を1行変えるだけで比較できる。

## 構成

```
.
├── debate.mjs          # 1トピック討論CLI
├── benchmark.mjs       # 固定トピックセット一括実行
├── debate-to-html.mjs  # JSON → メッセージアプリ風HTML変換
├── lib.mjs             # 共有コア関数
├── config.json         # 参加者・ベンチマークトピック設定
└── results/            # アーカイブ（自動生成）
```

## クイックスタート

```bash
# 1トピック討論（3ラウンド）
node debate.mjs "AIは人間の仕事を奪うか"

# 審判あり・ファイル保存
node debate.mjs "リモートワークは生産性を上げるか" --rounds 3 --judge --output result.json

# HTML化して確認
node debate-to-html.mjs result.json --output result.html
```

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

`config.json` を編集するだけ:

```json
{
  "participants": [
    { "name": "ChatGPT", "type": "openclaw", "model": "gpt-5.3-codex" },
    { "name": "Llama3",  "type": "ollama",   "model": "llama3.1:8b" },
    { "name": "Mistral", "type": "ollama",   "model": "mistral-nemo" }
  ],
  "benchmarkTopics": [
    "AIは人間の仕事を奪うか",
    "..."
  ]
}
```

新モデル（例: Qwen2.5）を試す場合:
```json
{ "name": "Qwen", "type": "ollama", "model": "qwen2.5:14b" }
```

## APIバックエンド

| 種別 | エンドポイント |
|------|--------------|
| `type: "openclaw"` | `docker exec openclaw-portable openclaw agent ...` |
| `type: "ollama"` | `http://localhost:11434/v1/chat/completions` |

## 審判モード（`--judge`）

全ターン終了後にChatGPTが3軸で採点:

| 軸 | 説明 |
|----|------|
| `japanese_quality` | 日本語の自然さ・流暢さ（英語混入や不自然な表現はマイナス） |
| `topic_relevance` | 論点への応答精度（前の発言に具体的に反応できているか） |
| `argument_coherence` | 論理の一貫性（立場がぶれていないか） |

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
    "ranking": ["ChatGPT", "Mistral", "Llama3"],
    "summary": "..."
  },
  "completedAt": "..."
}
```

## 制約・目安

| 項目 | 詳細 |
|------|------|
| 推奨ラウンド数 | 3〜5ラウンド |
| 技術的上限 | 約8〜9ラウンド（Ollamaコンテキスト上限 16,000トークン） |
| 1ラウンドの時間 | 約2分（ChatGPT:8秒 + Llama3:30〜60秒 + Mistral:60秒） |
| メモリ管理 | `keep_alive: 0` で即アンロード（2モデル同時ロード防止） |

## 環境要件

- Node.js 22+
- Docker（OpenClaw稼働中）
- Ollama（localhost:11434）

## 改造計画

- [ ] Fish-Speech連携 — スピーカーごとに声を変えて読み上げ
- [ ] Remotion動画化 — アバター付き討論動画の自動生成
- [ ] Discord投稿 — 結果をDiscordに自動投稿
