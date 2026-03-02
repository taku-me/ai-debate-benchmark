#!/usr/bin/env node
/**
 * debate.mjs - Multi-AI debate CLI
 *
 * Usage:
 *   node debate.mjs <topic> [options]
 *
 * Options:
 *   --rounds <n>        ラウンド数（デフォルト: 3）
 *   --judge             全ターン終了後にChatGPTが日本語能力を採点
 *   --config <file>     参加者設定JSONファイル（デフォルト: config.json）
 *   --archive <dir>     結果をアーカイブディレクトリに保存
 *   --output <file>     結果をJSONファイルに保存（省略時はstdout）
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { runDebate, topicSlug } from './lib.mjs';

// ── Args ──────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

const topic = args.find(a => !a.startsWith('--'));
if (!topic) {
  console.error('Usage: node debate.mjs <topic> [--rounds 3] [--judge] [--config config.json] [--archive ./results] [--output file.json]');
  process.exit(1);
}

function getOpt(flag, def = null) {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : def;
}
const hasFlag = f => args.includes(f);

const rounds     = parseInt(getOpt('--rounds', '3'));
const judge      = hasFlag('--judge');
const configFile = getOpt('--config', './config.json');
const archiveDir = getOpt('--archive');
const outputFile = getOpt('--output');

// ── Config ────────────────────────────────────────────────────────────────────

let participants;
try {
  const cfg = JSON.parse(readFileSync(resolve(configFile), 'utf-8'));
  participants = cfg.participants;
} catch {
  // config.json がなければデフォルト参加者
  participants = [
    { name: 'ChatGPT', type: 'openclaw' },
    { name: 'Llama3',  type: 'ollama', model: 'llama3.1:8b' },
    { name: 'Mistral', type: 'ollama', model: 'mistral-nemo' },
  ];
}

// ── Run ───────────────────────────────────────────────────────────────────────

console.error(`🎭 討論開始: "${topic}"`);
console.error(`👥 参加者: ${participants.map(p => p.name).join(' / ')}`);
console.error(`🔄 ラウンド数: ${rounds}${judge ? ' + 審判' : ''}`);

const result = await runDebate({
  topic,
  participants,
  rounds,
  judge,
  onProgress: msg => console.error(msg),
});

// ── Save ──────────────────────────────────────────────────────────────────────

const json = JSON.stringify(result, null, 2);

if (archiveDir) {
  mkdirSync(archiveDir, { recursive: true });
  const ts = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
  const path = resolve(archiveDir, `${ts}_${topicSlug(topic)}.json`);
  writeFileSync(path, json, 'utf-8');
  console.error(`\n📦 アーカイブ: ${path}`);
}

if (outputFile) {
  writeFileSync(outputFile, json, 'utf-8');
  console.error(`💾 保存完了: ${outputFile}`);
} else if (!archiveDir) {
  console.log(json);
}
