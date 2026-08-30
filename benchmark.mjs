#!/usr/bin/env node
/**
 * benchmark.mjs - 固定トピックセットで一括ベンチマーク実行
 *
 * Usage:
 *   node benchmark.mjs [options]
 *
 * Options:
 *   --rounds <n>       各トピックのラウンド数（デフォルト: 2）
 *   --config <file>    設定ファイル（デフォルト: config.json）
 *   --archive <dir>    結果の保存先（デフォルト: ./results）
 *   --output <file>    サマリーHTMLの出力先（デフォルト: results/summary.html）
 *   --topic <n>        特定のトピックのみ実行（0始まりのインデックス）
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { runDebate, topicSlug } from './lib.mjs';

// ── Args ──────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
function getOpt(flag, def = null) {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : def;
}

const rounds     = parseInt(getOpt('--rounds', '2'));
const configFile = getOpt('--config', './config.json');
const archiveDir = getOpt('--archive', './results');
const outputFile = getOpt('--output', null);
const topicIndex = getOpt('--topic');

// ── Config ────────────────────────────────────────────────────────────────────

const cfg = JSON.parse(readFileSync(resolve(configFile), 'utf-8'));
const { participants, benchmarkTopics } = cfg;

const topics = topicIndex !== null
  ? [benchmarkTopics[parseInt(topicIndex)]]
  : benchmarkTopics;

// ── Run ───────────────────────────────────────────────────────────────────────

mkdirSync(archiveDir, { recursive: true });

console.error(`🏆 ベンチマーク開始`);
console.error(`📋 トピック数: ${topics.length} / ラウンド数: ${rounds} / 審判: ON`);
console.error(`👥 参加者: ${participants.map(p => p.name).join(' / ')}\n`);

const allResults = [];

for (let i = 0; i < topics.length; i++) {
  const topic = topics[i];
  console.error(`\n${'═'.repeat(60)}`);
  console.error(`📌 [${i + 1}/${topics.length}] ${topic}`);
  console.error(`${'═'.repeat(60)}`);

  const result = await runDebate({
    topic,
    participants,
    rounds,
    judge: true,
    onProgress: msg => console.error(msg),
  });

  // アーカイブ保存
  const ts = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
  const archivePath = resolve(archiveDir, `${ts}_${topicSlug(topic)}.json`);
  writeFileSync(archivePath, JSON.stringify(result, null, 2), 'utf-8');
  console.error(`📦 保存: ${archivePath}`);

  allResults.push({ ...result, archivePath });
}

// ── Summary HTML ──────────────────────────────────────────────────────────────

const html = buildSummaryHtml(allResults, participants);
const summaryPath = outputFile ?? resolve(archiveDir, 'summary.html');
writeFileSync(summaryPath, html, 'utf-8');

console.error(`\n${'═'.repeat(60)}`);
console.error(`✅ ベンチマーク完了`);
console.error(`📊 サマリー: ${summaryPath}`);

// ── Summary HTML Builder ──────────────────────────────────────────────────────

function buildSummaryHtml(results, participants) {
  const COLORS = {
    ChatGPT: '#10a37f',
    Llama3:  '#7c5cfc',
    Mistral: '#f59e0b',
  };

  // 参加者ごとの平均スコアを集計
  const totals = {};
  const counts = {};
  for (const p of participants) {
    totals[p.name] = { japanese_quality: 0, topic_relevance: 0, argument_coherence: 0, wins: 0 };
    counts[p.name] = 0;
  }

  for (const r of results) {
    if (!r.judgment?.scores) continue;
    for (const [name, scores] of Object.entries(r.judgment.scores)) {
      if (!totals[name]) continue;
      totals[name].japanese_quality  += scores.japanese_quality  ?? 0;
      totals[name].topic_relevance   += scores.topic_relevance   ?? 0;
      totals[name].argument_coherence += scores.argument_coherence ?? 0;
      counts[name]++;
    }
    if (r.judgment.ranking?.[0]) {
      totals[r.judgment.ranking[0]].wins++;
    }
  }

  const avgs = Object.fromEntries(
    participants.map(p => {
      const n = counts[p.name] || 1;
      return [p.name, {
        japanese_quality:   (totals[p.name].japanese_quality  / n).toFixed(1),
        topic_relevance:    (totals[p.name].topic_relevance   / n).toFixed(1),
        argument_coherence: (totals[p.name].argument_coherence / n).toFixed(1),
        wins: totals[p.name].wins,
      }];
    })
  );

  const scoreRows = participants.map(p => {
    const a = avgs[p.name];
    const color = COLORS[p.name] ?? '#888';
    const total = ((+a.japanese_quality + +a.topic_relevance + +a.argument_coherence) / 3).toFixed(1);
    return `
      <tr>
        <td style="color:${color};font-weight:700">${p.name}</td>
        <td>${a.japanese_quality}</td>
        <td>${a.topic_relevance}</td>
        <td>${a.argument_coherence}</td>
        <td style="color:${color};font-weight:700">${total}</td>
        <td>${a.wins}勝 / ${results.length}試合</td>
      </tr>`;
  }).join('');

  const topicRows = results.map(r => {
    const ranking = r.judgment?.ranking ?? [];
    const summary = r.judgment?.summary ?? '—';
    return `
      <tr>
        <td class="topic-cell">${escHtml(r.topic)}</td>
        <td>${ranking.map((n, i) => `<span class="rank rank-${i+1}" style="color:${COLORS[n]??'#888'}">${n}</span>`).join(' ')}</td>
        <td class="summary-cell">${escHtml(summary)}</td>
      </tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AI討論ベンチマーク サマリー</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #0d0d0d; color: #e0e0e0; font-family: -apple-system, BlinkMacSystemFont, 'Hiragino Sans', sans-serif; font-size: 15px; padding: 32px 24px; max-width: 960px; margin: 0 auto; }
    h1 { font-size: 22px; margin-bottom: 4px; }
    .subtitle { color: #555; font-size: 13px; margin-bottom: 32px; }
    h2 { font-size: 15px; color: #888; text-transform: uppercase; letter-spacing: 0.08em; margin: 32px 0 12px; border-bottom: 1px solid #222; padding-bottom: 8px; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; font-size: 12px; color: #555; padding: 8px 12px; border-bottom: 1px solid #222; }
    td { padding: 10px 12px; border-bottom: 1px solid #1a1a1a; font-size: 14px; vertical-align: top; }
    tr:last-child td { border-bottom: none; }
    .topic-cell { max-width: 300px; }
    .summary-cell { color: #999; font-size: 13px; }
    .rank { font-weight: 700; margin-right: 4px; }
    .rank-1::before { content: '🥇 '; }
    .rank-2::before { content: '🥈 '; }
    .rank-3::before { content: '🥉 '; }
    .meta { color: #444; font-size: 12px; margin-top: 40px; text-align: center; }
    .back-nav { display: block; color: #6e7681; text-decoration: none; font-size: 12px; margin-bottom: 6px; }
    .back-nav:hover { color: #aaa; }
    @media print { .back-nav { display: none !important; } }
  </style>
</head>
<body>
  <a class="back-nav" href="/debate/">← AI討論一覧</a>
  <h1>🏆 AI討論ベンチマーク</h1>
  <div class="subtitle">${results.length}トピック・${participants.map(p=>p.name).join(' vs ')} — 生成: ${new Date().toLocaleString('ja-JP')}</div>

  <h2>総合スコア（平均）</h2>
  <table>
    <thead>
      <tr>
        <th>モデル</th>
        <th>日本語自然さ</th>
        <th>論点応答</th>
        <th>論理一貫性</th>
        <th>平均</th>
        <th>優勝</th>
      </tr>
    </thead>
    <tbody>${scoreRows}</tbody>
  </table>

  <h2>トピック別結果</h2>
  <table>
    <thead>
      <tr><th>トピック</th><th>ランキング</th><th>審判の総評</th></tr>
    </thead>
    <tbody>${topicRows}</tbody>
  </table>

  <div class="meta">審判: ChatGPT (gpt-5.3-codex)</div>
</body>
</html>`;
}

function escHtml(str) {
  return (str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
