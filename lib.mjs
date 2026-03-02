/**
 * lib.mjs - 共有コア関数
 */

import { execSync } from 'child_process';
import { randomBytes } from 'crypto';

// ── Ollama API ────────────────────────────────────────────────────────────────

export async function callOllama(model, messages) {
  const res = await fetch('http://localhost:11434/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // keep_alive: 0 = レスポンス後すぐにアンロード（2モデル同時ロード防止）
    body: JSON.stringify({ model, messages, stream: false, keep_alive: 0 }),
  });
  if (!res.ok) throw new Error(`Ollama error: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.choices[0].message.content.trim();
}

// ── OpenClaw API ──────────────────────────────────────────────────────────────

export function callOpenClaw(message) {
  const sessionId = `debate-${randomBytes(6).toString('hex')}`;
  const escaped = message.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
  const cmd = `docker exec openclaw-portable openclaw agent --session-id "${sessionId}" --message "${escaped}" --json`;
  const raw = execSync(cmd, { timeout: 120_000, encoding: 'utf-8' });
  const data = JSON.parse(raw);
  const text = data?.result?.payloads?.[0]?.text;
  if (!text) throw new Error(`Unexpected openclaw response: ${raw.slice(0, 200)}`);
  return text.trim();
}

// ── Prompt Building ───────────────────────────────────────────────────────────

export function buildHistory(turns) {
  return turns
    .filter(t => t.content)
    .map(t => `【${t.speaker}】\n${t.content}`)
    .join('\n\n---\n\n');
}

export function buildOllamaMessages(participant, turns, topic) {
  const system = [
    `あなたは「${participant.name}」というAIとして、以下のトピックについて討論に参加しています。`,
    `トピック: 「${topic}」`,
    '',
    'ルール:',
    '- 明確な立場を取り、論拠を述べてください',
    '- 前の発言者の意見に具体的に反応してください',
    '- 簡潔に（200〜400字程度）',
    '- 余計な前置きや自己紹介は不要です。論点を直接述べてください',
    `- あなたは ${participant.name} としてのキャラクターを保ってください`,
  ].join('\n');

  const userContent = turns.length === 0
    ? `トピック「${topic}」について、あなたの立場と意見を述べてください。`
    : `これまでの討論:\n\n${buildHistory(turns)}\n\nあなたの番です。前の発言に反応しながら議論を深めてください。`;

  return [
    { role: 'system', content: system },
    { role: 'user',   content: userContent },
  ];
}

export function buildOpenClawMessage(turns, topic, speakerName = 'ChatGPT') {
  const header = [
    `【討論参加依頼】`,
    `あなたは${speakerName}として以下の討論に参加しています。`,
    `トピック: 「${topic}」`,
    ``,
    `ルール: 明確な立場を取り、200〜400字程度で述べてください。余計な前置きは不要です。`,
  ].join('\n');

  if (turns.length === 0) {
    return `${header}\n\nこのトピックについて、最初の意見を述べてください。`;
  }
  return `${header}\n\nこれまでの討論:\n\n${buildHistory(turns)}\n\nあなたの番です。前の発言者（特に直前）に反応しながら意見を述べてください。`;
}

// ── Response Dispatcher ───────────────────────────────────────────────────────

export async function getResponse(participant, turns, topic) {
  if (participant.type === 'openclaw') {
    const message = buildOpenClawMessage(turns, topic, participant.name);
    return callOpenClaw(message);
  } else {
    const messages = buildOllamaMessages(participant, turns, topic);
    return callOllama(participant.model, messages);
  }
}

// ── Judge ─────────────────────────────────────────────────────────────────────

export function runJudge(result) {
  const participantNames = result.participants.map(p => p.name).join('、');
  const scoreKeys = result.participants.map(p => `    "${p.name}": { "japanese_quality": 0, "topic_relevance": 0, "argument_coherence": 0, "comment": "..." }`).join(',\n');

  const prompt = [
    `【AI日本語会話能力ベンチマーク評価依頼】`,
    ``,
    `以下はAIモデル間の討論ログです。各参加者の日本語会話能力を客観的に評価してください。`,
    `参加者: ${participantNames}`,
    `トピック: 「${result.topic}」`,
    ``,
    `=== 討論ログ ===`,
    ``,
    buildHistory(result.turns),
    ``,
    `=== 評価基準 ===`,
    `各参加者を以下の3軸で1〜10点で採点し、JSONのみ返してください（説明文・コードブロック不要）:`,
    `- japanese_quality: 日本語の自然さ・流暢さ（英語混入や不自然な表現はマイナス）`,
    `- topic_relevance: 論点への応答精度（前の発言に具体的に反応できているか）`,
    `- argument_coherence: 論理の一貫性（立場がぶれていないか）`,
    ``,
    `返答フォーマット（JSONのみ）:`,
    `{`,
    `  "scores": {`,
    scoreKeys,
    `  },`,
    `  "ranking": ["1位の名前", "2位の名前", "3位の名前"],`,
    `  "summary": "総評（2〜3文）"`,
    `}`,
  ].join('\n');

  console.error('⚖️  審判が評価中...');
  const raw = callOpenClaw(prompt);

  // JSONを抽出（前後に余計なテキストがあっても対応）
  const match = raw.match(/\{[\s\S]+\}/);
  if (!match) throw new Error(`Judge returned non-JSON: ${raw.slice(0, 300)}`);

  const judgment = JSON.parse(match[0]);
  return {
    evaluatedBy: 'ChatGPT',
    evaluatedAt: new Date().toISOString(),
    ...judgment,
  };
}

// ── Debate Runner ─────────────────────────────────────────────────────────────

export async function runDebate({ topic, participants, rounds, judge = false, onProgress }) {
  const result = {
    topic,
    startedAt: new Date().toISOString(),
    rounds,
    participants: participants.map(p => ({
      name:  p.name,
      type:  p.type,
      model: p.model ?? 'gpt-5.3-codex',
    })),
    turns: [],
  };

  let turnNumber = 1;

  for (let round = 1; round <= rounds; round++) {
    onProgress?.(`\n━━━ Round ${round} / ${rounds} ━━━`);

    for (const participant of participants) {
      onProgress?.(`⏳ ${participant.name} が考えています...`);

      try {
        const content = await getResponse(participant, result.turns, topic);
        const turn = {
          turn:      turnNumber++,
          round,
          speaker:   participant.name,
          content,
          timestamp: new Date().toISOString(),
        };
        result.turns.push(turn);
        const preview = content.replace(/\n/g, ' ').slice(0, 80);
        onProgress?.(`✅ ${participant.name}: ${preview}${content.length > 80 ? '…' : ''}\n`);
      } catch (err) {
        onProgress?.(`❌ ${participant.name} エラー: ${err.message}`);
        result.turns.push({
          turn:      turnNumber++,
          round,
          speaker:   participant.name,
          content:   null,
          error:     err.message,
          timestamp: new Date().toISOString(),
        });
      }
    }
  }

  result.completedAt = new Date().toISOString();

  if (judge) {
    try {
      result.judgment = runJudge(result);
      onProgress?.(`✅ 審判完了: ${result.judgment.ranking?.join(' > ')}`);
    } catch (err) {
      onProgress?.(`❌ 審判エラー: ${err.message}`);
    }
  }

  return result;
}

// ── Utilities ─────────────────────────────────────────────────────────────────

export function topicSlug(topic) {
  return topic.slice(0, 30).replace(/[\/\\:*?"<>|]/g, '-').replace(/\s+/g, '_');
}
