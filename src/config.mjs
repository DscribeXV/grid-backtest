// src/config.mjs
// =====================================================================================
// ★★★ 你最常改的地方就这一个文件 ★★★
// 跑回测前先看一遍这里。要换股票、改资金、调策略参数，全在这里改。
// 改完保存，然后在项目根目录双击 `启动回测.bat`（或运行 node src/run_all.mjs）。
// =====================================================================================

// ====== 1) 标的（要换股票就改这两个字段）=========================================
// A 股：6 位代码 + ".SZ"（深市）或 ".SH"（沪市）
// 例如：东信和平 002017.SZ / 平安银行 000001.SZ / 贵州茅台 600519.SH
export const SYMBOL_CODE = "002017";        // ★★★ 股票代码（6 位）
export const SYMBOL_NAME = "东信和平";        // ★★★ 股票名（仅显示用）
export const SYMBOL_EXCHANGE = "SZ";        // ★★★ "SZ"=深市, "SH"=沪市（决定数据源 secid 前缀）

// 改成别的股票时也建议把 data/processed/<代码>.csv 删掉，让程序重新拉数据
// =====================================================================================

// ====== 2) 回测时间窗口 ===========================================================
export const BACKTEST_START = "2024-01-01";  // ★★★ 回测开始（含）
export const BACKTEST_END   = "2025-12-31";  // ★★★ 回测结束（含）
// =====================================================================================

// ====== 3) 资金与成本（A 股标准）==================================================
export const INITIAL_CASH     = 200000;     // ★★★ 起始资金（元）
export const COMMISSION_RATE  = 0.00025;    // ★★★ 佣金 万 2.5（双边收）
export const COMMISSION_MIN   = 5;          // ★★★ 单笔最低佣金 5 元
export const STAMP_TAX_RATE   = 0.0005;     // ★★★ 印花税 万 5（仅卖出）
export const SLIPPAGE_TICKS   = 1;          // ★★★ 滑点：买卖各 1 个最小报价单位
export const TICK_SIZE        = 0.01;       // ★★★ A 股最小报价 0.01 元
export const LOT_SIZE         = 100;        // ★★★ 最小买卖单位 100 股
// =====================================================================================

// ====== 4) 网格策略参数 ===========================================================
// "standard_strict"：60 日通道 / 10 条等比线 / 30 笔上限
// "wide_window"    ：120 日通道 / 12 条等比线
// "narrow_dense"   ：30 日通道 / 16 条等比线（更敏感）
// "trend_follow"   ：20 日通道 / 10 条算术线 / 200 笔上限（试图跟车）
// "arithmetic_wide"：120 日通道 / 20 条算术线
// 要新增场景：在 SCENARIOS 数组里再 push 一个对象即可
export const SCENARIOS = [
  // ★★★ 改参数就改这里：name 唯一、label 显示名、params 里 6 个键可调
  { name: "standard_strict",  label: "标准网格（保守）",
    params: { window: 60, rebalance: 20, grid_count: 10, spacing: "geometric", position_cap_lots: 30, order_lots: 1 } },
  { name: "wide_window",      label: "宽通道（120日）",
    params: { window: 120, rebalance: 30, grid_count: 12, spacing: "geometric", position_cap_lots: 30, order_lots: 1 } },
  { name: "narrow_dense",     label: "窄通道密集网格",
    params: { window: 30, rebalance: 10, grid_count: 16, spacing: "geometric", position_cap_lots: 30, order_lots: 1 } },
  { name: "trend_follow",     label: "趋势跟随网格",
    params: { window: 20, rebalance: 10, grid_count: 10, spacing: "arithmetic", position_cap_lots: 200, order_lots: 1 } },
  { name: "arithmetic_wide",  label: "算术等差宽通道",
    params: { window: 120, rebalance: 30, grid_count: 20, spacing: "arithmetic", position_cap_lots: 30, order_lots: 1 } },
];

// "spacing" 可选值：
//   "geometric"  = 几何等比（推荐，价格越高的相邻线差越大；贴合股票）
//   "arithmetic" = 算术等差（相邻线价格差相等）
// =====================================================================================

// ====== 5) 输出行为 ===============================================================
// 每次跑回测，会把所有结果（数据、报告、图表、代码副本）打包到
//   results/runs/<时间戳>/
// 下面两个开关控制是否每次都重新拉数据 / 跑全部场景：
export const REFETCH_DATA   = false;   // ★★★ true = 每次都重新从东方财富拉数据；false = 用本地缓存
export const RUN_COMPARISON = true;    // ★★★ true = 跑 SCENARIOS 里的所有场景做对比；false = 只跑第一组
// =====================================================================================