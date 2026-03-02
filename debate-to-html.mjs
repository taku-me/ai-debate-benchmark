#!/usr/bin/env node
/**
 * debate-to-html.mjs - 討論JSONをメッセージアプリ風HTMLに変換
 * Usage: node debate-to-html.mjs <debate.json> [--output debate.html]
 */

import { readFileSync, writeFileSync } from 'fs';

const args = process.argv.slice(2);
const inputFile = args.find(a => !a.startsWith('--'));
if (!inputFile) {
  console.error('Usage: node debate-to-html.mjs <debate.json> [--output debate.html]');
  process.exit(1);
}
const outputIdx = args.indexOf('--output');
const outputFile = outputIdx !== -1 ? args[outputIdx + 1] : null;

const data = JSON.parse(readFileSync(inputFile, 'utf-8'));

// ── スタイル定義 ──────────────────────────────────────────────────────────────

const SPEAKERS = {
  ChatGPT: { color: '#10a37f', bg: '#1a3a2e', avatar: '🤖', label: 'ChatGPT' },
  Llama3:  { color: '#7c5cfc', bg: '#241a3a', avatar: '🦙', label: 'Llama3' },
  Mistral: { color: '#f59e0b', bg: '#3a2e10', avatar: '💨', label: 'Mistral' },
};

function getSpeaker(name) {
  return SPEAKERS[name] ?? { color: '#888', bg: '#222', avatar: '🤖', label: name };
}

function formatTime(iso) {
  return new Date(iso).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
}

function formatDuration(start, end) {
  const ms = new Date(end) - new Date(start);
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return m > 0 ? `${m}分${s}秒` : `${s}秒`;
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>');
}

// ── HTML生成 ──────────────────────────────────────────────────────────────────

function buildLegend(participants) {
  return participants.map(p => {
    const s = getSpeaker(p.name);
    return `
      <div class="legend-item">
        <span class="legend-avatar">${s.avatar}</span>
        <div>
          <div class="legend-name" style="color:${s.color}">${s.label}</div>
          <div class="legend-model">${p.model}</div>
        </div>
      </div>`;
  }).join('');
}

function buildTurns(turns, totalRounds) {
  let html = '';
  let lastRound = 0;

  for (const turn of turns) {
    if (turn.round !== lastRound) {
      lastRound = turn.round;
      html += `
      <div class="round-divider">
        <span>Round ${turn.round} / ${totalRounds}</span>
      </div>`;
    }

    const s = getSpeaker(turn.speaker);

    if (turn.error) {
      html += `
      <div class="message error-message">
        <div class="avatar">${s.avatar}</div>
        <div class="bubble error-bubble">
          <div class="speaker-name" style="color:${s.color}">${s.label}</div>
          <div class="content">❌ エラー: ${escapeHtml(turn.error)}</div>
        </div>
      </div>`;
    } else {
      html += `
      <div class="message" style="--speaker-color:${s.color};--speaker-bg:${s.bg}">
        <div class="avatar">${s.avatar}</div>
        <div class="bubble">
          <div class="speaker-name" style="color:${s.color}">${s.label}</div>
          <div class="content">${escapeHtml(turn.content)}</div>
          <div class="timestamp">${formatTime(turn.timestamp)}</div>
        </div>
      </div>`;
    }
  }

  return html;
}

function buildHtml(data) {
  const duration = data.completedAt
    ? formatDuration(data.startedAt, data.completedAt)
    : '実行中...';

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AI討論: ${data.topic}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      background: #0d0d0d;
      color: #e0e0e0;
      font-family: -apple-system, BlinkMacSystemFont, 'Hiragino Sans', 'Yu Gothic', sans-serif;
      font-size: 15px;
      line-height: 1.6;
      min-height: 100vh;
    }

    /* ヘッダー */
    .header {
      background: #111;
      border-bottom: 1px solid #222;
      padding: 20px 24px 16px;
      position: sticky;
      top: 0;
      z-index: 10;
    }
    .header-label {
      font-size: 11px;
      color: #555;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      margin-bottom: 6px;
    }
    .header-topic {
      font-size: 17px;
      font-weight: 600;
      color: #f0f0f0;
      line-height: 1.4;
    }
    .header-meta {
      display: flex;
      gap: 16px;
      margin-top: 10px;
      font-size: 12px;
      color: #555;
    }
    .header-meta span { display: flex; align-items: center; gap: 4px; }

    /* 参加者凡例 */
    .legend {
      display: flex;
      gap: 12px;
      padding: 12px 24px;
      background: #111;
      border-bottom: 1px solid #1a1a1a;
      flex-wrap: wrap;
    }
    .legend-item {
      display: flex;
      align-items: center;
      gap: 8px;
      background: #1a1a1a;
      padding: 6px 12px;
      border-radius: 20px;
    }
    .legend-avatar { font-size: 18px; }
    .legend-name { font-size: 13px; font-weight: 600; }
    .legend-model { font-size: 11px; color: #555; }

    /* チャット本体 */
    .chat {
      max-width: 800px;
      margin: 0 auto;
      padding: 20px 16px 60px;
    }

    /* ラウンド区切り */
    .round-divider {
      display: flex;
      align-items: center;
      gap: 12px;
      margin: 24px 0 16px;
    }
    .round-divider::before,
    .round-divider::after {
      content: '';
      flex: 1;
      height: 1px;
      background: #222;
    }
    .round-divider span {
      font-size: 12px;
      color: #444;
      white-space: nowrap;
      padding: 4px 12px;
      border: 1px solid #222;
      border-radius: 12px;
    }

    /* メッセージ */
    .message {
      display: flex;
      gap: 12px;
      margin-bottom: 16px;
      align-items: flex-start;
    }
    .avatar {
      font-size: 28px;
      flex-shrink: 0;
      width: 44px;
      height: 44px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #1a1a1a;
      border-radius: 50%;
      border: 1px solid #252525;
    }
    .bubble {
      background: var(--speaker-bg, #1a1a1a);
      border: 1px solid color-mix(in srgb, var(--speaker-color, #444) 30%, transparent);
      border-radius: 4px 16px 16px 16px;
      padding: 12px 16px;
      max-width: calc(100% - 60px);
    }
    .speaker-name {
      font-size: 12px;
      font-weight: 700;
      margin-bottom: 6px;
      letter-spacing: 0.03em;
    }
    .content {
      color: #d8d8d8;
      line-height: 1.75;
    }
    .timestamp {
      font-size: 11px;
      color: #444;
      margin-top: 8px;
      text-align: right;
    }
    .error-bubble {
      background: #2a1010;
      border-color: #5a1010;
    }

    /* フッター */
    .footer {
      text-align: center;
      padding: 32px;
      font-size: 12px;
      color: #333;
    }

    /* 審判スコア */
    .judgment {
      max-width: 800px;
      margin: 0 auto 40px;
      padding: 0 16px;
    }
    .judgment-header {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 13px;
      color: #555;
      margin-bottom: 16px;
      padding-bottom: 8px;
      border-bottom: 1px solid #222;
    }
    .score-table { width: 100%; border-collapse: collapse; }
    .score-table th {
      font-size: 11px;
      color: #555;
      text-align: left;
      padding: 6px 10px;
      border-bottom: 1px solid #222;
    }
    .score-table td {
      padding: 10px;
      border-bottom: 1px solid #1a1a1a;
      font-size: 13px;
    }
    .score-bar-wrap { display: flex; align-items: center; gap: 8px; }
    .score-bar {
      height: 6px;
      border-radius: 3px;
      flex-shrink: 0;
    }
    .score-num { font-weight: 700; min-width: 20px; }
    .judgment-summary {
      margin-top: 16px;
      padding: 12px 16px;
      background: #111;
      border: 1px solid #222;
      border-radius: 8px;
      font-size: 13px;
      color: #aaa;
      line-height: 1.7;
    }
    .ranking-chip {
      display: inline-block;
      padding: 2px 10px;
      border-radius: 12px;
      font-size: 12px;
      font-weight: 700;
      margin-right: 4px;
      border: 1px solid;
    }
  </style>
</head>
<body>

  <div class="header">
    <div class="header-label">AI 討論ログ</div>
    <div class="header-topic">${escapeHtml(data.topic)}</div>
    <div class="header-meta">
      <span>🔄 ${data.rounds}ラウンド</span>
      <span>💬 ${data.turns.length}ターン</span>
      <span>⏱ ${duration}</span>
      ${data.judgment ? '<span>⚖️ 審判あり</span>' : ''}
    </div>
  </div>

  <div class="legend">
    ${buildLegend(data.participants)}
  </div>

  <div class="chat">
    ${buildTurns(data.turns, data.rounds)}
  </div>

  ${data.judgment ? buildJudgment(data) : ''}

  <div class="footer">
    生成: ${new Date(data.startedAt).toLocaleString('ja-JP')}
  </div>

</body>
</html>`;
}

function buildJudgment(data) {
  const { judgment } = data;
  const scores = judgment.scores ?? {};
  const ranking = judgment.ranking ?? [];

  const rows = data.participants.map(p => {
    const s = getSpeaker(p.name);
    const sc = scores[p.name] ?? {};
    const axes = [
      { label: '日本語自然さ', val: sc.japanese_quality },
      { label: '論点応答',    val: sc.topic_relevance },
      { label: '論理一貫性',  val: sc.argument_coherence },
    ];
    const axeCells = axes.map(a => `
      <td>
        <div class="score-bar-wrap">
          <div class="score-bar" style="width:${(a.val ?? 0) * 10}px;background:${s.color}"></div>
          <span class="score-num" style="color:${s.color}">${a.val ?? '—'}</span>
        </div>
      </td>`).join('');
    const rankPos = ranking.indexOf(p.name);
    const medal = ['🥇','🥈','🥉'][rankPos] ?? '';
    return `
      <tr>
        <td style="color:${s.color};font-weight:700">${medal} ${p.name}</td>
        ${axeCells}
        <td style="color:#888;font-size:12px">${escapeHtml(sc.comment ?? '')}</td>
      </tr>`;
  }).join('');

  return `
  <div class="judgment">
    <div class="judgment-header">
      ⚖️ 審判結果（by ${escapeHtml(judgment.evaluatedBy ?? 'ChatGPT')}）
    </div>
    <table class="score-table">
      <thead>
        <tr>
          <th>モデル</th>
          <th>日本語自然さ</th>
          <th>論点応答</th>
          <th>論理一貫性</th>
          <th>コメント</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    ${judgment.summary ? `<div class="judgment-summary">${escapeHtml(judgment.summary)}</div>` : ''}
  </div>`;
}

// ── 出力 ──────────────────────────────────────────────────────────────────────

const html = buildHtml(data);

if (outputFile) {
  writeFileSync(outputFile, html, 'utf-8');
  console.log(`✅ 保存: ${outputFile}`);
} else {
  process.stdout.write(html);
}
