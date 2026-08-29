#!/usr/bin/env node
/**
 * tool-test.mjs - Ollamaモデルのツール使用能力テスト
 *
 * Usage:
 *   node tool-test.mjs [--models model1,model2] [--output results/tool-test.json]
 *
 * テスト項目:
 *   1. 基本ツール呼び出し    - ツールが必要な場面で呼び出せるか
 *   2. パラメータ精度        - 正しい引数を渡せるか
 *   3. ツール結果の活用      - 返り値を使って回答できるか（マルチターン）
 *   4. ツール不要の判断      - ツール不要な質問でハルシネーションしないか
 */

import { writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';

const OLLAMA_URL = 'http://localhost:11434';
const DEFAULT_MODELS = ['qwen3:8b', 'gemma3:4b', 'llama3.1:8b', 'mistral-nemo'];

// ── テストシナリオ ────────────────────────────────────────────────────────────

const SCENARIOS = [
  {
    id: 'basic_call',
    name: '基本ツール呼び出し',
    prompt: '東京の現在の天気を教えてください。',
    tools: [{
      type: 'function',
      function: {
        name: 'get_weather',
        description: '指定した都市の現在の天気情報を取得する',
        parameters: {
          type: 'object',
          properties: {
            city: { type: 'string', description: '都市名（日本語可）' }
          },
          required: ['city']
        }
      }
    }],
    mockFn: (name, args) => JSON.stringify({ city: args.city, weather: '晴れ', temp: 18, humidity: 45 }),
    evaluate: (call1, _final) => ({
      tool_called:      !!call1,
      correct_function: call1?.function?.name === 'get_weather',
      has_city_param:   !!parseArgs(call1)?.city,
    }),
  },
  {
    id: 'param_accuracy',
    name: 'パラメータ精度',
    prompt: '125 × 48 を計算してください。',
    tools: [{
      type: 'function',
      function: {
        name: 'calculate',
        description: '数式を計算して結果を返す',
        parameters: {
          type: 'object',
          properties: {
            expression: { type: 'string', description: '計算式（例: 3 * 4）' }
          },
          required: ['expression']
        }
      }
    }],
    mockFn: (name, args) => {
      try {
        const expr = args.expression.replace(/×/g, '*').replace(/÷/g, '/');
        return JSON.stringify({ result: Function(`"use strict"; return (${expr})`)() });
      } catch { return JSON.stringify({ error: 'invalid expression' }); }
    },
    evaluate: (call1, final) => ({
      tool_called:      !!call1,
      correct_function: call1?.function?.name === 'calculate',
      has_expression:   !!parseArgs(call1)?.expression,
      answer_correct:   final?.includes('6000'),  // 125*48=6000
    }),
  },
  {
    id: 'result_usage',
    name: 'ツール結果の活用',
    prompt: '東京の現在の気温を調べて、東京の年間平均気温（約15.4℃）と比較して高いか低いか教えてください。',
    tools: [{
      type: 'function',
      function: {
        name: 'get_temperature',
        description: '都市の現在の気温（℃）を取得する',
        parameters: {
          type: 'object',
          properties: {
            city: { type: 'string', description: '都市名' }
          },
          required: ['city']
        }
      }
    }],
    mockFn: (name, args) => JSON.stringify({ city: args.city, temperature: 22, unit: '℃' }),
    evaluate: (call1, final) => ({
      tool_called:   !!call1,
      used_result:   final?.includes('22') || false,
      answered_comparison: /高い|低い|上回|下回/.test(final || ''),
    }),
  },
  {
    id: 'no_tool_needed',
    name: 'ツール不要の判断',
    prompt: '日本の首都はどこですか？',
    tools: [{
      type: 'function',
      function: {
        name: 'search_web',
        description: 'ウェブを検索して最新情報を取得する',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: '検索クエリ' }
          },
          required: ['query']
        }
      }
    }],
    mockFn: () => JSON.stringify({ results: [] }),
    evaluate: (call1, final) => ({
      no_unnecessary_call: !call1,
      has_answer:          /東京/.test(final || ''),
    }),
  },
];

// ── Ollama API ────────────────────────────────────────────────────────────────

async function chat(model, messages, tools) {
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, tools, stream: false }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  return (await res.json()).message;
}

function parseArgs(toolCall) {
  if (!toolCall) return null;
  const raw = toolCall.function?.arguments;
  if (!raw) return {};
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
}

// ── シナリオ実行 ──────────────────────────────────────────────────────────────

async function runScenario(model, scenario) {
  const t0 = Date.now();
  try {
    const messages = [{ role: 'user', content: scenario.prompt }];

    // Turn 1
    const msg1 = await chat(model, messages, scenario.tools);
    const firstCall = msg1.tool_calls?.[0] ?? null;

    let finalContent = msg1.content ?? '';

    // Turn 2（ツールが呼ばれた場合）
    if (firstCall) {
      const args = parseArgs(firstCall);
      const toolResult = scenario.mockFn(firstCall.function?.name, args ?? {});

      messages.push({ role: 'assistant', content: msg1.content ?? '', tool_calls: msg1.tool_calls });
      messages.push({ role: 'tool', content: toolResult });

      const msg2 = await chat(model, messages, scenario.tools);
      finalContent = msg2.content ?? '';
    }

    const evaluation = scenario.evaluate(firstCall, finalContent);
    const passed = Object.values(evaluation).filter(Boolean).length;
    const total  = Object.keys(evaluation).length;

    return {
      status:     'ok',
      elapsed_ms: Date.now() - t0,
      tool_call:  firstCall ? { name: firstCall.function?.name, args: parseArgs(firstCall) } : null,
      response:   finalContent,
      evaluation,
      score:      passed / total,
    };
  } catch (err) {
    return { status: 'error', error: err.message, elapsed_ms: Date.now() - t0, score: 0, evaluation: {} };
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const getOpt = (flag, def) => { const i = argv.indexOf(flag); return i !== -1 ? argv[i + 1] : def; };

const models     = (getOpt('--models', null) ?? DEFAULT_MODELS.join(',')).split(',');
const outputFile = getOpt('--output', './results/tool-test.json');
const htmlFile   = getOpt('--html',   './results/tool-test.html');

console.error(`🔧 ツール使用能力テスト`);
console.error(`📋 モデル: ${models.join(', ')}`);
console.error(`🧪 シナリオ: ${SCENARIOS.map(s => s.name).join(' / ')}\n`);

const results = {};

for (const model of models) {
  console.error(`\n🤖 ${model}`);
  results[model] = {};

  for (const scenario of SCENARIOS) {
    process.stderr.write(`  ⏳ ${scenario.name}... `);
    const r = await runScenario(model, scenario);
    results[model][scenario.id] = r;

    if (r.status === 'error') {
      console.error(`❌ ${r.error}`);
    } else {
      const pct = (r.score * 100).toFixed(0);
      const items = Object.entries(r.evaluation)
        .map(([k, v]) => `${v ? '✓' : '✗'}${k}`)
        .join(' ');
      console.error(`${pct}%  [${items}]  ${r.elapsed_ms}ms`);
    }
  }

  const avg = SCENARIOS.reduce((s, sc) => s + (results[model][sc.id]?.score ?? 0), 0) / SCENARIOS.length;
  console.error(`  📊 平均: ${(avg * 100).toFixed(0)}%`);
}

// ── 保存 ──────────────────────────────────────────────────────────────────────

const output = {
  generated_at: new Date().toISOString(),
  models,
  scenarios: SCENARIOS.map(s => ({ id: s.id, name: s.name, prompt: s.prompt })),
  results,
};

mkdirSync(resolve(outputFile, '..'), { recursive: true });
writeFileSync(resolve(outputFile), JSON.stringify(output, null, 2));
writeFileSync(resolve(htmlFile), generateHtml(output));

console.error(`\n💾 JSON: ${outputFile}`);
console.error(`🌐 HTML: ${htmlFile}`);

// ── HTML生成 ──────────────────────────────────────────────────────────────────

function generateHtml(data) {
  const avgScore = model => {
    const vals = SCENARIOS.map(s => data.results[model]?.[s.id]?.score ?? 0);
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  };
  const scoreClass = v => v >= 0.75 ? 'hi' : v >= 0.5 ? 'mid' : 'lo';
  const sorted = [...data.models].sort((a, b) => avgScore(b) - avgScore(a));

  const summaryRows = sorted.map(m => {
    const avg = avgScore(m);
    const cells = SCENARIOS.map(s => {
      const r = data.results[m]?.[s.id];
      if (!r || r.status === 'error') return `<td class="lo">Err</td>`;
      return `<td class="${scoreClass(r.score)}">${(r.score * 100).toFixed(0)}%</td>`;
    }).join('');
    return `<tr><td class="model">${m}</td>${cells}<td class="${scoreClass(avg)}">${(avg * 100).toFixed(0)}%</td></tr>`;
  }).join('');

  const detailSections = SCENARIOS.map(s => {
    const rows = sorted.map(m => {
      const r = data.results[m]?.[s.id];
      if (!r || r.status === 'error') {
        return `<tr><td class="model">${m}</td><td colspan="4" class="lo">${r?.error ?? 'エラー'}</td></tr>`;
      }
      const evalHtml = Object.entries(r.evaluation)
        .map(([k, v]) => `<span class="${v ? 'check' : 'cross'}">${v ? '✓' : '✗'} ${k}</span>`)
        .join(' ');
      const callHtml = r.tool_call
        ? `<code>${r.tool_call.name}(${JSON.stringify(r.tool_call.args)})</code>`
        : '<span class="dim">なし</span>';
      const resp = (r.response ?? '').slice(0, 120) + ((r.response?.length ?? 0) > 120 ? '…' : '');
      return `<tr>
        <td class="model">${m}</td>
        <td style="font-size:12px">${evalHtml}</td>
        <td class="mono">${callHtml}</td>
        <td class="dim sm">${resp}</td>
        <td class="dim sm">${r.elapsed_ms}ms</td>
      </tr>`;
    }).join('');

    return `
      <h2>${s.name}</h2>
      <div class="prompt">💬 ${s.prompt}</div>
      <table>
        <thead><tr><th>モデル</th><th>評価</th><th>ツール呼び出し</th><th>最終回答</th><th>時間</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>ツール使用能力テスト</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{background:#0d0d0d;color:#e0e0e0;font-family:-apple-system,'Hiragino Sans',sans-serif;font-size:14px;padding:32px 24px;max-width:960px;margin:0 auto}
    h1{font-size:20px;margin-bottom:4px}
    .sub{color:#555;font-size:13px;margin-bottom:32px}
    h2{font-size:13px;color:#888;text-transform:uppercase;letter-spacing:.08em;margin:28px 0 10px;border-bottom:1px solid #222;padding-bottom:6px}
    table{width:100%;border-collapse:collapse;margin-bottom:24px}
    th{text-align:left;font-size:11px;color:#555;padding:8px 10px;border-bottom:1px solid #222}
    td{padding:9px 10px;border-bottom:1px solid #1a1a1a;vertical-align:top}
    .model{font-weight:700}
    .hi{color:#4ade80;font-weight:700}
    .mid{color:#facc15;font-weight:700}
    .lo{color:#f87171;font-weight:700}
    .check{color:#4ade80}
    .cross{color:#f87171}
    .dim{color:#666}
    .sm{font-size:12px}
    .mono code{font-family:monospace;font-size:11px;color:#6aba6a;background:#111a11;padding:2px 6px;border-radius:3px}
    .prompt{background:#111;border:1px solid #222;border-radius:4px;padding:8px 12px;font-size:13px;color:#aaa;margin-bottom:10px}
    .back-nav{display:block;color:#6e7681;text-decoration:none;font-size:12px;margin-bottom:6px}
    .back-nav:hover{color:#aaa}
    @media print{.back-nav{display:none!important}}
  </style>
</head>
<body>
  <a class="back-nav" href="/debate/">← AI討論一覧</a>
  <h1>🔧 ツール使用能力テスト</h1>
  <div class="sub">生成: ${new Date(data.generated_at).toLocaleString('ja-JP')} / ${data.models.length}モデル / ${data.scenarios.length}シナリオ</div>
  <h2>総合スコア</h2>
  <table>
    <thead><tr><th>モデル</th>${SCENARIOS.map(s => `<th>${s.name}</th>`).join('')}<th>平均</th></tr></thead>
    <tbody>${summaryRows}</tbody>
  </table>
  ${detailSections}
</body>
</html>`;
}
