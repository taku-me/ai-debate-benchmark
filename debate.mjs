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
 *   --no-publish        HTML生成・web公開をスキップ
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { runDebate, topicSlug } from './lib.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

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
const monitor    = hasFlag('--monitor');
const noPublish  = hasFlag('--no-publish');
const configFile = getOpt('--config', './config.json');
const archiveDir = getOpt('--archive');
const outputFile = getOpt('--output');

const PUBLIC_DIR = '/Volumes/SANDBOX/services/public/debate';
const MANIFEST   = `${PUBLIC_DIR}/manifest.json`;

// ── Config ────────────────────────────────────────────────────────────────────

let participants;
try {
  const cfg = JSON.parse(readFileSync(resolve(configFile), 'utf-8'));
  participants = cfg.participants;
} catch {
  // config.json がなければデフォルト参加者
  participants = [
    { name: 'Llama3',  type: 'ollama', model: 'llama3.1:8b' },
    { name: 'Mistral', type: 'ollama', model: 'mistral-nemo' },
  ];
}

// ── Run ───────────────────────────────────────────────────────────────────────

console.error(`🎭 討論開始: "${topic}"`);
console.error(`👥 参加者: ${participants.map(p => p.name).join(' / ')}`);
console.error(`🔄 ラウンド数: ${rounds}${judge ? ' + 審判' : ''}${monitor ? ' + 負荷監視' : ''}`);

const result = await runDebate({
  topic,
  participants,
  rounds,
  judge,
  monitor,
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

// ── HTML生成 & web公開 ────────────────────────────────────────────────────────

if (!noPublish) {
  try {
    // JSON を一時ファイルに書き出し
    const tmpJson = resolve(__dirname, `.tmp-debate-${Date.now()}.json`);
    writeFileSync(tmpJson, json, 'utf-8');

    // HTML 生成
    const htmlFile = `debate-${topicSlug(topic)}.html`;
    const htmlDest = `${PUBLIC_DIR}/${htmlFile}`;
    mkdirSync(PUBLIC_DIR, { recursive: true });
    execSync(`node ${resolve(__dirname, 'debate-to-html.mjs')} ${tmpJson} --output ${htmlDest}`);
    execSync(`rm ${tmpJson}`);
    console.error(`🌐 HTML: ${htmlDest}`);

    // manifest.json 更新（先頭に追加）
    let manifest = [];
    try { manifest = JSON.parse(readFileSync(MANIFEST, 'utf-8')); } catch {}
    // 同じファイル名が既にあれば置き換え
    manifest = manifest.filter(e => e.file !== htmlFile);
    manifest.unshift({
      file: htmlFile,
      date: new Date().toISOString().slice(0, 19),
      title: topic,
      participants: result.participants.map(p => p.name),
    });
    writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2), 'utf-8');
    console.error(`📋 manifest 更新: ${MANIFEST}`);
    console.error(`🔗 http://100.84.44.28:18791/debate/${htmlFile}`);
  } catch (err) {
    console.error(`❌ 公開エラー: ${err.message}`);
  }
}
