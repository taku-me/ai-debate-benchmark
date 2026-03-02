/**
 * monitor.mjs - システムリソースのサンプリングモジュール
 *
 * Usage:
 *   import { createMonitor } from './monitor.mjs';
 *   const mon = createMonitor(2000); // 2秒ごとにサンプリング
 *   await mon.start();
 *   await mon.sample('Llama3 thinking'); // 任意タイミングで追加記録
 *   await mon.stop();
 *   const metrics = mon.getMetrics();
 */

import os from 'os';

export function createMonitor(intervalMs = 2000) {
  const metrics = [];
  let timer = null;

  async function sample(event = null) {
    const totalMem = os.totalmem();
    const freeMem  = os.freemem();

    let ollamaLoaded = [];
    try {
      const ps = await fetch('http://localhost:11434/api/ps').then(r => r.json());
      ollamaLoaded = ps.models.map(m => ({
        name:    m.name,
        size_gb: +(m.size / 1073741824).toFixed(1),
      }));
    } catch { /* Ollamaが落ちていても続行 */ }

    const point = {
      ts:        new Date().toISOString(),
      cpu_load:  +os.loadavg()[0].toFixed(2),  // 1分平均loadavg
      ram_used:  +((totalMem - freeMem) / 1073741824).toFixed(2),
      ram_free:  +(freeMem / 1073741824).toFixed(2),
      ram_total: +(totalMem / 1073741824).toFixed(1),
      ollama:    ollamaLoaded,
      event,
    };
    metrics.push(point);
    return point;
  }

  async function start() {
    await sample('debate_start');
    timer = setInterval(() => sample(), intervalMs);
  }

  async function stop() {
    if (timer) { clearInterval(timer); timer = null; }
    await sample('debate_end');
  }

  function getMetrics() { return metrics; }

  function getSummary() {
    if (metrics.length === 0) return null;
    const rams = metrics.map(m => m.ram_used);
    const cpus = metrics.map(m => m.cpu_load);
    return {
      ram_peak_gb:   Math.max(...rams),
      ram_min_gb:    Math.min(...rams),
      cpu_load_peak: Math.max(...cpus),
      cpu_load_avg:  +(cpus.reduce((a, b) => a + b, 0) / cpus.length).toFixed(2),
      cpu_count:     os.cpus().length,
      sample_count:  metrics.length,
      duration_sec:  Math.round(
        (new Date(metrics.at(-1).ts) - new Date(metrics[0].ts)) / 1000
      ),
    };
  }

  return { start, stop, sample, getMetrics, getSummary };
}
