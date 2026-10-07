// src/grid_engine.mjs
// Grid-trading backtest engine.
//
// Strategy (standard two-side grid):
//   1. At t=window-1, look back `window` days and set channel = [min(low), max(high)].
//   2. Place N+1 grid lines in that channel. Geometric spacing (configurable).
//   3. On each subsequent bar (using next-day open as the fill price to avoid look-ahead):
//        - if price crosses ABOVE a line, SELL one lot at that line (only if inventory >= 1 lot).
//        - if price crosses BELOW a line, BUY  one lot at that line (only if cash >= 1 lot * price).
//   4. Refit the channel every `rebalance` bars (rolling window updates).
//   5. Track cash, inventory, equity, mark-to-market equity = cash + shares * close.
//
// Realism:
//   - Commission 万2.5 (0.00025), min 5 CNY; stamp tax 0.0005 on sells only.
//   - Slippage = 1 price tick per side (1 cent for prices < 10, else 1 cent or so).
//   - 100-share lot, integer shares only.

export const DEFAULT_PARAMS = {
  initial_cash: 200000,         // 20 万 起始资金
  window: 60,                   // 滚动通道窗口
  rebalance: 20,                // 每 20 个交易日重新拟合通道
  grid_count: 10,               // 网格条数（线 = grid_count + 1）
  spacing: "geometric",         // "geometric" | "arithmetic"
  position_cap_lots: 30,        // 最大持仓 30 笔（一笔 = 100 股）
  order_lots: 1,                // 每次触发买卖 1 笔 = 100 股
  commission_rate: 0.00025,     // 万 2.5
  commission_min: 5,            // 最低 5 元
  stamp_tax_rate: 0.0005,       // 印花税 万 5，卖出收
  slippage_ticks: 1,            // 滑点：买卖各 1 个最小报价单位
  tick_size: 0.01,              // A 股最小报价 1 分钱
  lot_size: 100,
};

function roundShares(shares, lot) {
  return Math.max(0, Math.floor(shares / lot) * lot);
}

function commission(price, shares, rate, min) {
  return Math.max(min, price * shares * rate);
}

export function runBacktest(bars, params = {}) {
  const p = { ...DEFAULT_PARAMS, ...params };
  if (!Array.isArray(bars) || bars.length < p.window + 2) {
    throw new Error(`Need at least ${p.window + 2} bars, got ${bars?.length ?? 0}`);
  }

  const state = {
    cash: p.initial_cash,
    shares: 0,
    avg_cost: 0,            // 移动平均成本
    grid: null,             // { lower, upper, lines: [p0, p1, ...] }
    last_prices_below: {},  // 每条线：上一次价格是否在线下（用于判断"穿越"）
    last_bar_index: -1,
  };

  const equityCurve = [];   // { date, close, cash, shares, equity, drawdown }
  const trades = [];        // { date, side, price, shares, amount, fee, tax, pnl, cash_after, shares_after, grid_id, channel_lower, channel_upper }
  const events = [];        // { date, type, detail }
  const refitDates = [];

  // helper: build grid in [lo, hi]
  function buildGrid(lo, hi) {
    const n = p.grid_count;
    const lines = [];
    if (p.spacing === "geometric") {
      const r = Math.pow(hi / lo, 1 / n);
      for (let i = 0; i <= n; i++) lines.push(+(lo * Math.pow(r, i)).toFixed(2));
    } else {
      const step = (hi - lo) / n;
      for (let i = 0; i <= n; i++) lines.push(+(lo + step * i).toFixed(2));
    }
    return { lower: +lo.toFixed(2), upper: +hi.toFixed(2), lines };
  }

  // helper: refit channel from window of bars ending at index `end` (inclusive)
  function refit(end) {
    const lo = Math.min(...bars.slice(end - p.window + 1, end + 1).map(b => b.low));
    const hi = Math.max(...bars.slice(end - p.window + 1, end + 1).map(b => b.high));
    const g = buildGrid(lo, hi);
    state.grid = g;
    // 重置 last_prices_below：用 refit 当天的 close 做基线
    state.last_prices_below = {};
    const lastClose = bars[end].close;
    for (const line of g.lines) {
      state.last_prices_below[line] = lastClose < line;
    }
    refitDates.push(bars[end].date);
  }

  // 初始 refit
  refit(p.window - 1);

  // 主循环：第 window 根 bar 开始每天判断是否触发
  for (let i = p.window; i < bars.length; i++) {
    const bar = bars[i];

    // 周期 refit
    if (i > p.window && (i - (p.window - 1)) % p.rebalance === 0) {
      refit(i - 1);
      events.push({ date: bar.date, type: "refit",
        detail: { lower: state.grid.lower, upper: state.grid.upper, lines: state.grid.lines } });
    }

    // 用当日 open 触发（更接近真实"T+0 决策"），fill price = open ± slippage
    const fillBase = bar.open;
    const cash0 = state.cash;
    const shares0 = state.shares;
    const lotShares = p.order_lots * p.lot_size;

    // 遍历网格线：从上往下扫，先卖后买（同一根 bar 资金循环不会触发——我们用一价买卖简化，不允许同 bar 自成交）
    const sortedLines = [...state.grid.lines].sort((a, b) => b - a);
    for (const line of sortedLines) {
      const wasBelow = state.last_prices_below[line];
      const isBelow = fillBase < line;
      const crossedUp = wasBelow && !isBelow;     // 价从线下涨破到线
      const crossedDown = !wasBelow && isBelow;   // 价从线上跌破到线

      if (crossedUp) {
        // 触发卖出（仅当有持仓）
        if (state.shares >= lotShares) {
          const fillPrice = +(fillBase + p.slippage_ticks * p.tick_size).toFixed(2);
          const amt = fillPrice * lotShares;
          const fee = commission(fillPrice, lotShares, p.commission_rate, p.commission_min);
          const tax = amt * p.stamp_tax_rate;
          const proceeds = amt - fee - tax;
          const cost = state.avg_cost * lotShares;
          const pnl = proceeds - cost;
          state.cash += proceeds;
          state.shares -= lotShares;
          if (state.shares === 0) state.avg_cost = 0;
          else state.avg_cost = (state.avg_cost * (state.shares + lotShares) - cost) / state.shares;
          trades.push({
            date: bar.date, side: "SELL", price: fillPrice, shares: lotShares,
            gross_amount: +amt.toFixed(2), fee: +fee.toFixed(2), tax: +tax.toFixed(2),
            net_amount: +proceeds.toFixed(2), realized_pnl: +pnl.toFixed(2),
            cash_after: +state.cash.toFixed(2), shares_after: state.shares,
            grid_id: line, channel_lower: state.grid.lower, channel_upper: state.grid.upper,
          });
          state.last_prices_below[line] = isBelow;
        } else {
          state.last_prices_below[line] = isBelow;
        }
      } else if (crossedDown) {
        // 触发买入（仅当资金够 + 持仓未到上限）
        const maxShares = p.position_cap_lots * p.lot_size;
        const costPerLot = fillBase * lotShares * (1 + p.commission_rate); // 估算，留 buffer
        if (state.cash >= costPerLot && state.shares + lotShares <= maxShares) {
          const fillPrice = +(fillBase - p.slippage_ticks * p.tick_size).toFixed(2);
          const amt = fillPrice * lotShares;
          const fee = commission(fillPrice, lotShares, p.commission_rate, p.commission_min);
          const total = amt + fee;
          if (state.cash >= total) {
            state.cash -= total;
            state.avg_cost = (state.avg_cost * state.shares + amt) / (state.shares + lotShares);
            state.shares += lotShares;
            trades.push({
              date: bar.date, side: "BUY", price: fillPrice, shares: lotShares,
              gross_amount: +amt.toFixed(2), fee: +fee.toFixed(2), tax: 0,
              net_amount: +total.toFixed(2), realized_pnl: 0,
              cash_after: +state.cash.toFixed(2), shares_after: state.shares,
              grid_id: line, channel_lower: state.grid.lower, channel_upper: state.grid.upper,
            });
            state.last_prices_below[line] = isBelow;
          } else {
            state.last_prices_below[line] = isBelow;
          }
        } else {
          state.last_prices_below[line] = isBelow;
        }
      } else {
        // 状态没变，跨日时仅更新"基线"以避免一价触发多线
        state.last_prices_below[line] = isBelow;
      }
    }

    // 记录当日权益（用 close 估值）
    const equity = state.cash + state.shares * bar.close;
    equityCurve.push({
      date: bar.date,
      open: bar.open, high: bar.high, low: bar.low, close: bar.close,
      cash: +state.cash.toFixed(2),
      shares: state.shares,
      equity: +equity.toFixed(2),
    });
  }

  // 期末按最后一日 close 强制清仓做"已实现收益"基线（可选：保留持仓）
  const lastBar = bars[bars.length - 1];
  const lastEquity = state.cash + state.shares * lastBar.close;

  return {
    params: p,
    initial_cash: p.initial_cash,
    final_cash: +state.cash.toFixed(2),
    final_shares: state.shares,
    final_avg_cost: +state.avg_cost.toFixed(2),
    final_equity: +lastEquity.toFixed(2),
    trades,
    equity_curve: equityCurve,
    events,
    refit_dates: refitDates,
  };
}

// ---------- 指标 ----------
export function computeMetrics(result, benchmarkBars) {
  const { equity_curve, trades, initial_cash, final_equity } = result;
  const ec = equity_curve;
  const nDays = ec.length;
  const nYears = nDays / 252;

  // 总收益 / 年化
  const totalRet = final_equity / initial_cash - 1;
  const cagr = nYears > 0 ? Math.pow(final_equity / initial_cash, 1 / nYears) - 1 : 0;

  // 最大回撤
  let peak = ec[0].equity, maxDD = 0, maxDDDate = null, peakDate = null;
  for (const p of ec) {
    if (p.equity > peak) { peak = p.equity; peakDate = p.date; }
    const dd = p.equity / peak - 1;
    if (dd < maxDD) { maxDD = dd; maxDDDate = p.date; }
  }

  // 日收益
  const dailyReturns = [];
  for (let i = 1; i < ec.length; i++) {
    dailyReturns.push(ec[i].equity / ec[i - 1].equity - 1);
  }
  const mean = dailyReturns.reduce((a, b) => a + b, 0) / Math.max(1, dailyReturns.length);
  const variance = dailyReturns.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, dailyReturns.length);
  const std = Math.sqrt(variance);
  const annVol = std * Math.sqrt(252);
  const sharpe = annVol > 0 ? (mean * 252) / annVol : 0;

  // 胜率、盈亏比
  const closes = trades.filter(t => t.realized_pnl !== 0);
  const wins = closes.filter(t => t.realized_pnl > 0);
  const losses = closes.filter(t => t.realized_pnl < 0);
  const winRate = closes.length ? wins.length / closes.length : 0;
  const avgWin = wins.length ? wins.reduce((a, t) => a + t.realized_pnl, 0) / wins.length : 0;
  const avgLoss = losses.length ? losses.reduce((a, t) => a + t.realized_pnl, 0) / losses.length : 0;
  const profitFactor = losses.length
    ? Math.abs(wins.reduce((a, t) => a + t.realized_pnl, 0) / losses.reduce((a, t) => a + t.realized_pnl, 0))
    : (wins.length ? Infinity : 0);
  const totalFees = trades.reduce((a, t) => a + t.fee + t.tax, 0);

  // 基准 (买入持有)
  let bench = null;
  if (benchmarkBars && benchmarkBars.length) {
    const first = benchmarkBars[0].close;
    const last = benchmarkBars[benchmarkBars.length - 1].close;
    const benchShares = Math.floor(initial_cash / (first * 100)) * 100;
    const benchFinal = benchShares * last + (initial_cash - benchShares * first);
    bench = {
      symbol: "BUY_HOLD",
      first_close: first,
      last_close: last,
      shares: benchShares,
      final_equity: +benchFinal.toFixed(2),
      total_return: benchFinal / initial_cash - 1,
    };
  }

  return {
    n_days: nDays,
    n_years: +nYears.toFixed(3),
    initial_cash,
    final_equity: +final_equity.toFixed(2),
    total_return: +totalRet.toFixed(4),
    cagr: +cagr.toFixed(4),
    max_drawdown: +maxDD.toFixed(4),
    max_drawdown_date: maxDDDate,
    peak_date: peakDate,
    ann_volatility: +annVol.toFixed(4),
    sharpe: +sharpe.toFixed(3),
    n_trades: trades.length,
    n_buys: trades.filter(t => t.side === "BUY").length,
    n_sells: trades.filter(t => t.side === "SELL").length,
    n_round_trips: closes.length / 2,
    win_rate: +winRate.toFixed(4),
    avg_win: +avgWin.toFixed(2),
    avg_loss: +avgLoss.toFixed(2),
    profit_factor: Number.isFinite(profitFactor) ? +profitFactor.toFixed(3) : "Inf",
    total_fees: +totalFees.toFixed(2),
    benchmark: bench,
  };
}