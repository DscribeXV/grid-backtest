// src/run_all.mjs
// =====================================================================================
// ★ 不用改这里 —— 这是主调度脚本
//   它会读 src/config.mjs，拉数据，跑 SCENARIOS 里所有场景，
//   把所有结果打包进 results/runs/<时间戳>/ 下。
// =====================================================================================

import fs from "node:fs/promises";
import path from "node:path";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";
import { runBacktest, computeMetrics } from "./grid_engine.mjs";
import { writeAll } from "./report.mjs";
import { fetchAndCache } from "./data_source.mjs";
import {
  SYMBOL_CODE, SYMBOL_NAME, SYMBOL_EXCHANGE,
  BACKTEST_START, BACKTEST_END,
  INITIAL_CASH, COMMISSION_RATE, COMMISSION_MIN,
  STAMP_TAX_RATE, SLIPPAGE_TICKS, TICK_SIZE, LOT_SIZE,
  SCENARIOS, REFETCH_DATA, RUN_COMPARISON,
} from "./config.mjs";

const PROJECT_ROOT = process.cwd();

function nowStamp() {
  const d = new Date();
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

async function ensureDir(p) {
  await fs.mkdir(p, { recursive: true });
}

async function copyFile(src, dst) {
  try {
    await fs.copyFile(src, dst);
  } catch (e) {
    // 缺源文件时静默跳过
  }
}

async function snapshotProject(runDir) {
  const snapDir = path.join(runDir, "src_snapshot");
  await ensureDir(snapDir);
  for (const f of ["config.mjs", "grid_engine.mjs", "report.mjs", "data_source.mjs", "run_all.mjs"]) {
    await copyFile(path.join(PROJECT_ROOT, "src", f), path.join(snapDir, f));
  }
}

async function main() {
  console.log("============================================================");
  console.log(` 网格交易回测 — 标的: ${SYMBOL_NAME} (${SYMBOL_CODE}.${SYMBOL_EXCHANGE})`);
  console.log(` 区间: ${BACKTEST_START} → ${BACKTEST_END}   起始资金: ¥${INITIAL_CASH.toLocaleString("zh-CN")}`);
  console.log("============================================================");

  // 1) 建本次 run 目录
  const stamp = nowStamp();
  const runDir = path.join("results", "runs", stamp);
  await ensureDir(runDir);
  console.log(`[run] output dir: ${runDir}`);

  // 2) 拉数据（缓存到 data/，并把副本也存到 run 目录）
  const csvPath = await fetchAndCache({
    symbol: SYMBOL_CODE, name: SYMBOL_NAME, exchange: SYMBOL_EXCHANGE,
    start: BACKTEST_START, end: BACKTEST_END, force: REFETCH_DATA,
  });
  await copyFile(csvPath, path.join(runDir, "data_used.csv"));

  // 3) 读数据
  const raw = await fs.readFile(csvPath, "utf8");
  const records = parse(raw, { columns: true, skip_empty_lines: true, bom: true });
  const bars = records.map(r => ({
    date: r.date, open: +r.open, close: +r.close, high: +r.high, low: +r.low,
    volume: +r.volume, amount: +r.amount,
  }));
  console.log(`[run] bars loaded: ${bars.length} (${bars[0].date} → ${bars.at(-1).date})`);

  // 4) 跑所有场景
  const baseParams = {
    initial_cash: INITIAL_CASH,
    commission_rate: COMMISSION_RATE,
    commission_min: COMMISSION_MIN,
    stamp_tax_rate: STAMP_TAX_RATE,
    slippage_ticks: SLIPPAGE_TICKS,
    tick_size: TICK_SIZE,
    lot_size: LOT_SIZE,
  };
  const scenarios = RUN_COMPARISON ? SCENARIOS : SCENARIOS.slice(0, 1);

  const rows = [];
  for (const s of scenarios) {
    const params = { ...baseParams, ...s.params };
    const result = runBacktest(bars, params);
    const metrics = computeMetrics(result, bars);
    const outDirs = {
      equityDir: path.join(runDir, "scenarios", s.name, "equity"),
      tradesDir: path.join(runDir, "scenarios", s.name, "trades"),
      chartsDir: path.join(runDir, "scenarios", s.name, "charts"),
      reportsDir: path.join(runDir, "scenarios", s.name, "reports"),
    };
    const { metrics: writtenMetrics } = await writeAll({
      symbol: `${SYMBOL_CODE}_${s.name}`,
      name: `${SYMBOL_NAME} / ${s.label}`,
      result, metrics, outDirs,
    });
    rows.push({ name: s.name, label: s.label, params, ...metrics });
    const r = (x, d=2) => (x*100).toFixed(d);
    console.log(`  • ${s.name.padEnd(20)} ret=${r(metrics.total_return).padStart(7)}%  CAGR=${r(metrics.cagr).padStart(7)}%  MaxDD=${r(metrics.max_drawdown).padStart(7)}%  Sharpe=${String(metrics.sharpe).padStart(6)}  Trades=${metrics.n_trades}`);
  }

  // 5) 写对比表
  const cmp = {
    symbol: `${SYMBOL_CODE}.${SYMBOL_EXCHANGE}`,
    name: SYMBOL_NAME,
    range: { start: BACKTEST_START, end: BACKTEST_END, n_bars: bars.length, first_bar: bars[0].date, last_bar: bars.at(-1).date },
    params: baseParams,
    scenarios: rows,
    timestamp: stamp,
  };
  await fs.writeFile(path.join(runDir, "comparison.json"), JSON.stringify(cmp, null, 2), "utf8");

  const benchRet = rows[0].benchmark?.total_return ?? 0;
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"/>
<title>网格交易参数对比 — ${SYMBOL_NAME} (${SYMBOL_CODE}.${SYMBOL_EXCHANGE}) — ${stamp}</title>
<style>
  body { font-family: "Segoe UI","Microsoft YaHei",Arial,sans-serif; margin:0; background:#f7f7fa; color:#222; }
  .wrap { max-width: 1180px; margin: 0 auto; padding: 24px; }
  h1 { margin: 0 0 6px 0; font-size: 22px; }
  h2 { margin: 28px 0 10px 0; font-size: 18px; border-left: 4px solid #1f77b4; padding-left: 8px; }
  .meta { color: #666; font-size: 13px; }
  table { border-collapse: collapse; width: 100%; background: #fff; font-size: 13px; }
  th, td { border: 1px solid #e5e7eb; padding: 6px 8px; text-align: right; }
  th { background: #f0f2f5; }
  td.l, th.l { text-align: left; }
  .pos { color: #2ca02c; } .neg { color: #d62728; }
  .small { color: #666; font-size: 12px; }
  .links a { display: inline-block; margin: 4px 8px 4px 0; padding: 6px 10px; background: #1f77b4; color: #fff; border-radius: 4px; text-decoration: none; font-size: 13px; }
  .links a:hover { background: #155a8a; }
</style>
</head>
<body>
<div class="wrap">
  <h1>网格交易参数对比 — ${SYMBOL_NAME} (${SYMBOL_CODE}.${SYMBOL_EXCHANGE})</h1>
  <div class="meta">回测时间：${stamp} &nbsp;·&nbsp; 区间：${BACKTEST_START} → ${BACKTEST_END}（${bars.length} 根日线） &nbsp;·&nbsp; 起始资金：¥${INITIAL_CASH.toLocaleString("zh-CN")}</div>
  <p class="small">基准"买入持有"总收益 = ${(benchRet*100).toFixed(2)}%。点下面的链接跳到每个场景的详细报告。</p>

  <h2>各场景报告</h2>
  <div class="links">
    ${rows.map(r => `<a href="scenarios/${r.name}/reports/${SYMBOL_CODE}_${r.name}_report.html">${r.label}</a>`).join("\n    ")}
  </div>

  <h2>对比表</h2>
  <table>
    <thead>
      <tr>
        <th class="l">场景</th>
        <th class="l">参数摘要</th>
        <th>总收益</th>
        <th>CAGR</th>
        <th>最大回撤</th>
        <th>夏普</th>
        <th>年化波动</th>
        <th>期末权益</th>
        <th>交易笔数</th>
        <th>胜率</th>
        <th>盈亏因子</th>
      </tr>
    </thead>
    <tbody>
${rows.map(r => `<tr>
  <td class="l">${r.label}</td>
  <td class="l small">w=${r.params.window} reb=${r.params.rebalance} grid=${r.params.grid_count} ${r.params.spacing} cap=${r.params.position_cap_lots}</td>
  <td class="${r.total_return>=0?"pos":"neg"}">${(r.total_return*100).toFixed(2)}%</td>
  <td class="${r.cagr>=0?"pos":"neg"}">${(r.cagr*100).toFixed(2)}%</td>
  <td class="neg">${(r.max_drawdown*100).toFixed(2)}%</td>
  <td>${r.sharpe}</td>
  <td>${(r.ann_volatility*100).toFixed(2)}%</td>
  <td>¥${Math.round(r.final_equity).toLocaleString("zh-CN")}</td>
  <td>${r.n_trades}</td>
  <td>${(r.win_rate*100).toFixed(2)}%</td>
  <td>${r.profit_factor}</td>
</tr>`).join("\n")}
    </tbody>
  </table>

  <h2>结论速读</h2>
  <ul>
    <li>本回测 ${SYMBOL_NAME} (${SYMBOL_CODE}.${SYMBOL_EXCHANGE}) 在 ${BACKTEST_START} → ${BACKTEST_END} 期间走出 ${(benchRet*100).toFixed(2)}% 的收益。买入持有是直接持有 100 股 × 1 手的近似对照。</li>
    <li>网格策略在 <b>震荡 / 高换手</b> 标的上更能体现优势；本数据若为单边行情，网格大概率跑输买入持有。</li>
    <li>想改股票或参数？编辑 <code>src/config.mjs</code>（文件里有 ★ 注释），改完再双击 <code>启动回测.bat</code>。</li>
  </ul>
</div>
</body>
</html>`;
  await fs.writeFile(path.join(runDir, "comparison.html"), html, "utf8");

  // 6) 写一个 README + 快照源码
  const readme = `# 网格交易回测 — ${SYMBOL_NAME} (${SYMBOL_CODE}.${SYMBOL_EXCHANGE})
生成时间：${stamp}
回测区间：${BACKTEST_START} → ${BACKTEST_END}（${bars.length} 根日线）
起始资金：¥${INITIAL_CASH.toLocaleString("zh-CN")}

## 目录结构
- comparison.html          本次回测的对比总报告（先看这个）
- comparison.json          所有场景的指标 JSON
- data_used.csv            本次回测使用的日线数据
- src_snapshot/            本次回测的源码快照（万一后续改了 config 也能复现）
- scenarios/<name>/
    ├── reports/<code>_<name>_report.html    单场景完整报告（含 6 张图）
    ├── charts/                               6 张 SVG 图
    ├── equity/                               逐日权益 CSV
    └── trades/                               逐笔成交 CSV

## 怎么调整
1. 编辑 src\\config.mjs（用 ★ 注释标好了）
2. 保存后双击项目根目录的 启动回测.bat
3. 浏览器会自动打开最新一次回测的 comparison.html
`;
  await fs.writeFile(path.join(runDir, "README.md"), readme, "utf8");
  await snapshotProject(runDir);

  console.log("\n============================================================");
  console.log(` ✅ 全部完成！输出目录：${runDir}`);
  console.log(`    入口：${path.join(runDir, "comparison.html")}`);
  console.log("============================================================");
}

main().catch(e => { console.error(e); process.exit(1); });