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

    @media print {
      body { background: #fff; color: #111; font-size: 13px; }
      .header { background: #f5f5f5; border-bottom: 1px solid #ccc; position: static; }
      .header-topic { color: #111; }
      .header-meta, .header-label { color: #555; }
      .legend { background: #f5f5f5; border-bottom: 1px solid #eee; }
      .legend-item { background: #eee; }
      .legend-model { color: #777; }
      .bubble {
        background: #f9f9f9 !important;
        border: 1px solid #ddd !important;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
      .content { color: #222; }
      .timestamp { color: #999; }
      .round-divider span { border-color: #ccc; color: #888; }
      .round-divider::before, .round-divider::after { background: #ddd; }
      .avatar { background: #eee; border-color: #ddd; }
      .score-table th { color: #777; border-color: #ddd; }
      .score-table td { border-color: #eee; }
      .judgment-summary { background: #f5f5f5; border-color: #ddd; color: #444; }
      .footer { color: #aaa; }
      /* グラフはPDFでは非表示（Canvas描画はPDFに含まれない） */
      canvas { display: none; }
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
      ${data.metrics  ? '<span>📊 負荷監視あり</span>' : ''}
    </div>
  </div>

  <div class="legend">
    ${buildLegend(data.participants)}
  </div>

  <div class="chat">
    ${buildTurns(data.turns, data.rounds)}
  </div>

  ${data.judgment ? buildJudgment(data) : ''}
  ${data.metrics  ? buildMetrics(data)  : ''}

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

function buildHealth(s, ramTotal) {
  const ramPct   = s.ram_peak_gb / ramTotal * 100;
  const minFree  = +(ramTotal - s.ram_peak_gb).toFixed(2);
  const cpuCount = s.cpu_count || 4;
  const cpuPct   = s.cpu_load_peak / cpuCount * 100;

  // RAM 判定
  let ramBadge, ramColor, ramDetail, ramAdvice;
  if (ramPct >= 95) {
    ramBadge  = '危険';  ramColor = '#ef4444';
    ramDetail = `ピーク ${s.ram_peak_gb} GB / ${ramTotal} GB（${ramPct.toFixed(0)}%）— 空き ${minFree} GB`;
    ramAdvice = 'OOMリスクあり。参加モデル数を減らすか、より軽量なモデル（7B→3B等）への変更を検討してください。';
  } else if (ramPct >= 85) {
    ramBadge  = '注意';  ramColor = '#f59e0b';
    ramDetail = `ピーク ${s.ram_peak_gb} GB / ${ramTotal} GB（${ramPct.toFixed(0)}%）— 空き ${minFree} GB`;
    ramAdvice = '余裕が少ない状態。他の重いプロセスとの同時実行は避けること。';
  } else {
    ramBadge  = '正常';  ramColor = '#10a37f';
    ramDetail = `ピーク ${s.ram_peak_gb} GB / ${ramTotal} GB（${ramPct.toFixed(0)}%）— 空き ${minFree} GB`;
    ramAdvice = '余裕あり。モデルの追加や高性能モデルへの変更も可能な状態です。';
  }

  // CPU 判定（loadavg / コア数）
  let cpuBadge, cpuColor, cpuDetail, cpuAdvice;
  if (cpuPct >= 80) {
    cpuBadge  = '危険';  cpuColor = '#ef4444';
    cpuDetail = `ピーク ${s.cpu_load_peak}（${cpuCount}コア比 ${cpuPct.toFixed(0)}%）、平均 ${s.cpu_load_avg}`;
    cpuAdvice = '高負荷。他のプロセスへの影響が大きく、応答遅延が発生する可能性があります。';
  } else if (cpuPct >= 50) {
    cpuBadge  = '注意';  cpuColor = '#f59e0b';
    cpuDetail = `ピーク ${s.cpu_load_peak}（${cpuCount}コア比 ${cpuPct.toFixed(0)}%）、平均 ${s.cpu_load_avg}`;
    cpuAdvice = '中〜高負荷。並列処理や追加タスクは控えめに。';
  } else {
    cpuBadge  = '正常';  cpuColor = '#10a37f';
    cpuDetail = `ピーク ${s.cpu_load_peak}（${cpuCount}コア比 ${cpuPct.toFixed(0)}%）、平均 ${s.cpu_load_avg}`;
    cpuAdvice = '負荷は軽微。CPU起因のボトルネックはありません。';
  }

  // 総評
  const worstPct = Math.max(ramPct, cpuPct);
  let overall;
  if (worstPct >= 95) {
    overall = `このマシンにとって限界に近い構成です。${ramPct >= cpuPct ? `RAM が ${ramPct.toFixed(0)}% まで逼迫しており、モデル増加や大型モデル化は困難です。` : `CPU が高負荷状態で、他サービスへの影響が懸念されます。`}`;
  } else if (worstPct >= 85) {
    overall = `現在の構成で動作しますが余裕は少ない状態です。安定運用のためにはモデルの軽量化かマシンスペックの強化を検討してください。`;
  } else if (worstPct >= 50) {
    overall = `適切な負荷範囲内です。現在の構成は安定しており、1〜2モデルの追加も試せます。`;
  } else {
    overall = `このマシンにとって軽い負荷です。モデル追加・ラウンド数増加・より大きなモデルへの変更を積極的に試せます。`;
  }

  const badge = (label, color) =>
    `<span style="color:${color};border:1px solid ${color};padding:2px 10px;border-radius:10px;font-size:11px;font-weight:700;white-space:nowrap">${label}</span>`;

  return `
    <div style="background:#111;border:1px solid #222;border-radius:8px;padding:14px 16px;margin-bottom:14px;display:flex;flex-direction:column;gap:10px">
      <div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap">
        ${badge('RAM ' + ramBadge, ramColor)}
        <span style="font-size:13px;color:#bbb">${ramDetail}</span>
        <span style="font-size:12px;color:#666">${ramAdvice}</span>
      </div>
      <div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap">
        ${badge('CPU ' + cpuBadge, cpuColor)}
        <span style="font-size:13px;color:#bbb">${cpuDetail}</span>
        <span style="font-size:12px;color:#666">${cpuAdvice}</span>
      </div>
      <div style="border-top:1px solid #1e1e1e;padding-top:10px;font-size:12px;color:#666;line-height:1.7">
        💡 ${overall}
      </div>
    </div>`;
}

function buildMetrics(data) {
  const { metrics, metricsSummary: s } = data;
  if (!metrics?.length) return '';

  const SPEAKER_COLORS = {
    ChatGPT: '#10a37f', Llama3: '#7c5cfc', Mistral: '#f59e0b',
    Qwen2_5: '#06b6d4', Qwen3: '#ec4899',
  };

  // Chart.jsに渡すデータをJSON化
  const labels   = JSON.stringify(metrics.map(m => new Date(m.ts).toLocaleTimeString('ja-JP')));
  const ramData  = JSON.stringify(metrics.map(m => m.ram_used));
  const cpuData  = JSON.stringify(metrics.map(m => m.cpu_load));
  const ramTotal = metrics[0]?.ram_total ?? 16;

  // イベント（ターン開始）のインデックスを抽出 → 縦線アノテーション
  const annotations = metrics
    .map((m, i) => ({ i, event: m.event }))
    .filter(e => e.event?.endsWith(':start'))
    .map(e => {
      const speaker = e.event.replace(':start', '');
      const color = SPEAKER_COLORS[speaker] ?? '#888';
      return `"ann${e.i}": { type: "line", xMin: ${e.i}, xMax: ${e.i}, borderColor: "${color}", borderWidth: 1, borderDash: [4,3], label: { display: true, content: "${speaker}", color: "${color}", font: { size: 10 }, position: "start" } }`;
    }).join(',\n');

  const health = s ? buildHealth(s, ramTotal) : '';

  const summaryItems = s ? [
    `RAM ピーク: <strong>${s.ram_peak_gb} GB</strong> / ${ramTotal} GB`,
    `CPU loadavg ピーク: <strong>${s.cpu_load_peak}</strong>（${s.cpu_count ?? '?'}コア）`,
    `平均: RAM ${s.ram_min_gb}〜${s.ram_peak_gb} GB / CPU ${s.cpu_load_avg}`,
    `${s.sample_count}サンプル・${s.duration_sec}秒`,
  ].map(t => `<span>${t}</span>`).join('') : '';

  return `
  <div style="max-width:800px;margin:0 auto 40px;padding:0 16px">
    <div style="display:flex;align-items:center;gap:8px;font-size:13px;color:#555;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid #222">
      📊 負荷監視レポート
    </div>
    ${health}
    <div style="display:flex;gap:16px;flex-wrap:wrap;font-size:12px;color:#666;margin-bottom:16px">
      ${summaryItems}
    </div>
    <div style="background:#111;border:1px solid #222;border-radius:8px;padding:16px">
      <canvas id="metricsChart" height="120"></canvas>
    </div>
  </div>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/chartjs-plugin-annotation@3.1.0/dist/chartjs-plugin-annotation.min.js"></script>
  <script>
    new Chart(document.getElementById('metricsChart'), {
      data: {
        labels: ${labels},
        datasets: [
          {
            type: 'line', label: 'RAM使用量 (GB)',
            data: ${ramData},
            borderColor: '#7c5cfc', backgroundColor: 'rgba(124,92,252,0.15)',
            fill: true, tension: 0.3, pointRadius: 0, yAxisID: 'yRam',
          },
          {
            type: 'line', label: 'CPU loadavg',
            data: ${cpuData},
            borderColor: '#f59e0b', backgroundColor: 'transparent',
            tension: 0.3, pointRadius: 0, borderDash: [4,2], yAxisID: 'yCpu',
          },
        ],
      },
      options: {
        responsive: true,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { labels: { color: '#888', font: { size: 11 } } },
          annotation: { annotations: { ${annotations} } },
        },
        scales: {
          x:    { ticks: { color: '#555', maxTicksLimit: 10, font: { size: 10 } }, grid: { color: '#1a1a1a' } },
          yRam: { position: 'left',  min: 0, max: ${ramTotal}, ticks: { color: '#7c5cfc', font: { size: 10 } }, grid: { color: '#1a1a1a' }, title: { display: true, text: 'RAM (GB)', color: '#7c5cfc', font: { size: 10 } } },
          yCpu: { position: 'right', min: 0,                   ticks: { color: '#f59e0b', font: { size: 10 } }, grid: { display: false },    title: { display: true, text: 'CPU load', color: '#f59e0b', font: { size: 10 } } },
        },
      },
    });
  </script>`;
}

// ── 出力 ──────────────────────────────────────────────────────────────────────

const html = buildHtml(data);

if (outputFile) {
  writeFileSync(outputFile, html, 'utf-8');
  console.log(`✅ 保存: ${outputFile}`);
} else {
  process.stdout.write(html);
}
