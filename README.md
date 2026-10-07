# 网格交易回测系统（Grid Trading Backtest）

一个用纯 Node.js（ES Module）写的**网格交易策略回测工具**：自动从公开行情接口拉取日线数据，
在历史数据上模拟网格买卖，输出权益曲线、回撤、月度收益、买卖点等图表与多场景对比报告。

> 仅供学习与技术研究使用，不构成任何投资建议。回测收益不代表未来表现。

## 特性

- 纯 ES Module，零框架、零构建，一条命令跑完
- 自动拉取并缓存日线数据（默认标的：东信和平 002017.SZ，可自行更换）
- 5 种内置网格场景横向对比：标准网格 / 宽通道 / 窄通道密集 / 趋势跟随 / 等差宽通道
- 完整 A 股交易成本建模：佣金（含单笔最低 5 元）、印花税、滑点、100 股整手
- 输出 HTML 报告 + SVG 图表 + 逐日权益 CSV + 逐笔成交 CSV
- 每次回测独立存档（含当次源码快照），历史结果可复现

## 环境要求

- Node.js 18 及以上（用到了内置 `fetch`）

## 快速开始

```bash
git clone <本仓库地址>
cd grid-backtest
npm install

# 跑回测
node src/run_all.mjs
```

跑完去看 `results/runs/<时间戳>/comparison.html`（所有场景横向对比，这是入口报告）。

Windows 用户也可以直接双击 `启动回测.bat`：自动跑回测并打开对比报告。

## 配置

要改的东西几乎都在 **`src/config.mjs`**，文件顶部用 `★★★` 标了出来：

| 位置 | 作用 |
| --- | --- |
| 第 1 段 | 标的：股票代码 / 名称 / 交易所（`SZ` 深市、`SH` 沪市） |
| 第 2 段 | 回测时间窗口 |
| 第 3 段 | 起始资金、佣金、印花税、滑点、整手股数 |
| 第 4 段 | 网格场景 `SCENARIOS`（可自由增删） |
| 第 5 段 | 是否强制重新拉数据 / 是否跑全部场景对比 |

换股票示例：把 `SYMBOL_CODE` 改成 `600519`、`SYMBOL_EXCHANGE` 改成 `SH`，并删掉
`data/processed/` 下的旧缓存 CSV，重新运行即可。

网格线的两种间距方式：

- `geometric`：几何等比（价格越高，相邻线价差越大），更贴合股票
- `arithmetic`：算术等差（相邻线价差相等）

`SCENARIOS` 里每个参数的含义：`window` 通道窗口、`rebalance` 再平衡周期、
`grid_count` 网格条数、`spacing` 间距方式、`position_cap_lots` 持仓上限（手）、
`order_lots` 每次下单手数。

## 目录结构

```
grid-backtest/
├── 启动.bat                  # 双击：用 VSCode 打开本项目
├── 启动回测.bat              # 双击：跑回测 + 打开对比报告
├── package.json
├── src/
│   ├── config.mjs            # ★ 最常改的一个文件
│   ├── data_source.mjs       # 数据源（拉取 + 缓存日线）
│   ├── grid_engine.mjs       # 回测引擎 + 网格策略 + 绩效指标
│   ├── report.mjs            # 报告生成（HTML + SVG 图表）
│   ├── run_all.mjs           # 主调度入口
│   ├── compare.mjs           # 多场景对比
│   ├── run.mjs               # 单场景运行
│   └── fetch_data.mjs        # 旧版单次回测脚本（保留）
├── data/                     # 运行时自动生成：行情缓存
└── results/                  # 运行时自动生成：回测结果
    └── runs/<YYYYMMDD_HHMMSS>/
        ├── comparison.html   # 入口报告
        ├── comparison.json   # 所有场景指标
        ├── data_used.csv     # 本次使用的数据
        ├── src_snapshot/     # 本次用的源码副本
        └── scenarios/<场景名>/
            ├── reports/      # 单场景完整报告
            ├── charts/       # SVG 图表
            ├── equity/       # 逐日权益 CSV
            └── trades/       # 逐笔成交 CSV
```

`data/` 与 `results/` 已在 `.gitignore` 中忽略，不会污染仓库。

## 数据源

东方财富公开 K 线接口（`push2his.eastmoney.com`），无需 token 或密钥，也无需付费账号。
请在遵守数据提供方使用条款的前提下使用。

## 免责声明

本项目仅用于技术学习与策略研究。任何基于本项目产生的投资决策及其后果，由使用者自行承担。
