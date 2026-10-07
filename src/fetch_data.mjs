// src/fetch_data.mjs
// Pull 2024-2025 daily K-line for 东信和平 (002017.SZ) from Eastmoney's public API.
// Saves raw JSON to data/raw/<symbol>.json and a clean CSV to data/processed/<symbol>.csv.

import fs from "node:fs/promises";
import path from "node:path";

const SYMBOL = "002017";
const NAME = "东信和平";
const MARKET = "0";
const SECID = `${MARKET}.${SYMBOL}`;
const OUT_DIR_RAW = "data/raw";
const OUT_DIR_CSV = "data/processed";

const URL = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${SECID}` +
  `&fields1=f1,f2,f3,f4,f5,f6` +
  `&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61` +
  `&klt=101&fqt=1&beg=20240101&end=20251231`;

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  "Referer": "https://quote.eastmoney.com/",
};

function csvEscape(v) {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function klineToRow(k) {
  const [date, open, close, high, low, vol, amt, amp, chgPct, chgAmt, turnover] = k.split(",");
  return { date, open: +open, close: +close, high: +high, low: +low,
           volume: +vol, amount: +amt, amplitude: +amp,
           change_pct: +chgPct, change_amt: +chgAmt, turnover: +turnover };
}

async function main() {
  await fs.mkdir(OUT_DIR_RAW, { recursive: true });
  await fs.mkdir(OUT_DIR_CSV, { recursive: true });

  console.log(`[fetch] GET ${URL}`);
  const res = await fetch(URL, { headers: HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  const json = await res.json();
  if (!json.data || !Array.isArray(json.data.klines)) {
    throw new Error(`Unexpected response: ${JSON.stringify(json).slice(0, 300)}`);
  }

  const rawPath = path.join(OUT_DIR_RAW, `${SYMBOL}.json`);
  await fs.writeFile(rawPath, JSON.stringify(json, null, 2), "utf8");
  console.log(`[fetch] saved raw: ${rawPath} (${json.data.klines.length} bars)`);

  const rows = json.data.klines.map(klineToRow);
  const header = ["date","open","close","high","low","volume","amount","amplitude","change_pct","change_amt","turnover"];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(header.map(h => csvEscape(r[h])).join(","));
  }
  const csvPath = path.join(OUT_DIR_CSV, `${SYMBOL}.csv`);
  await fs.writeFile(csvPath, "\uFEFF" + lines.join("\n"), "utf8");
  console.log(`[fetch] saved csv : ${csvPath} (${rows.length} rows)`);

  if (rows.length === 0) throw new Error("No data returned.");
  const first = rows[0], last = rows[rows.length - 1];
  console.log(`[fetch] range: ${first.date} -> ${last.date}`);
  console.log(`[fetch] first close: ${first.close}, last close: ${last.close}`);
}

main().catch(e => { console.error(e); process.exit(1); });