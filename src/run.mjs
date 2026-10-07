// src/run.mjs
// Orchestrator: read CSV -> run backtest -> write all outputs.

import fs from "node:fs/promises";
import path from "node:path";
import { parse } from "csv-parse/sync";
import { runBacktest, computeMetrics } from "./grid_engine.mjs";
import { writeAll } from "./report.mjs";

const SYMBOL = "002017";
const NAME = "东信和平";
const DATA_CSV = path.join("data", "processed", `${SYMBOL}.csv`);

async function main() {
  console.log("[run] reading", DATA_CSV);
  const raw = await fs.readFile(DATA_CSV, "utf8");
  const records = parse(raw, { columns: true, skip_empty_lines: true, bom: true });
  const bars = records.map(r => ({
    date: r.date,
    open: +r.open, close: +r.close, high: +r.high, low: +r.low,
    volume: +r.volume, amount: +r.amount,
  }));
  console.log(`[run] bars: ${bars.length} (${bars[0].date} -> ${bars.at(-1).date})`);

  // 默认参数（A 股常规配置）
  const params = {
    initial_cash: 200000,
    window: 60,
    rebalance: 20,
    grid_count: 10,
    spacing: "geometric",
    position_cap_lots: 30,
    order_lots: 1,
    commission_rate: 0.00025,
    commission_min: 5,
    stamp_tax_rate: 0.0005,
    slippage_ticks: 1,
    tick_size: 0.01,
    lot_size: 100,
  };

  console.log("[run] running backtest...");
  const result = runBacktest(bars, params);
  const metrics = computeMetrics(result, bars);

  const outDirs = {
    equityDir: "results/equity",
    tradesDir: "results/trades",
    chartsDir: "results/charts",
    reportsDir: "results/reports",
  };
  const { metrics: writtenMetrics } = await writeAll({ symbol: SYMBOL, name: NAME, result, metrics, outDirs });

  console.log("\n========== SUMMARY ==========");
  console.log(`Symbol: ${NAME} (${SYMBOL})`);
  console.log(`Range : ${writtenMetrics.first_date} -> ${writtenMetrics.last_date} (${writtenMetrics.n_days} days)`);
  console.log(`Initial: ¥${metrics.initial_cash.toLocaleString("zh-CN")}  Final: ¥${metrics.final_equity.toLocaleString("zh-CN")}`);
  console.log(`Total return: ${(metrics.total_return * 100).toFixed(2)}%   CAGR: ${(metrics.cagr * 100).toFixed(2)}%`);
  console.log(`Max DD: ${(metrics.max_drawdown * 100).toFixed(2)}%   Sharpe: ${metrics.sharpe}   Vol: ${(metrics.ann_volatility * 100).toFixed(2)}%`);
  console.log(`Trades: ${metrics.n_trades} (BUY ${metrics.n_buys} / SELL ${metrics.n_sells})   Win rate: ${(metrics.win_rate * 100).toFixed(2)}%   PF: ${metrics.profit_factor}`);
  if (metrics.benchmark) {
    console.log(`Benchmark buy-hold: ${(metrics.benchmark.total_return * 100).toFixed(2)}%   Excess: ${((metrics.total_return - metrics.benchmark.total_return) * 100).toFixed(2)}%`);
  }
  console.log("\nOutputs:");
  for (const d of Object.values(outDirs)) console.log("  -", d);
  console.log("  - results/reports/" + SYMBOL + "_report.html");
}

main().catch(e => { console.error(e); process.exit(1); });