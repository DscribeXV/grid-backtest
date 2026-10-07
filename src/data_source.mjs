// src/data_source.mjs
// 数据源：东方财富公开 K 线接口（免 token）
// 内部使用，对外暴露 fetchAndCache() —— 拉到 CSV 并缓存到 data/processed/

import fs from "node:fs/promises";
import path from "node:path";

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

function dateToInt(s) {
  return parseInt(s.replace(/-/g, ""), 10);
}

export async function fetchAndCache({ symbol, name, exchange, start, end, force = false }) {
  const market = exchange === "SH" ? "1" : "0"; // 1=SH, 0=SZ
  const secid = `${market}.${symbol}`;
  const startInt = dateToInt(start);
  const endInt = dateToInt(end);
  const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}` +
    `&fields1=f1,f2,f3,f4,f5,f6` +
    `&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61` +
    `&klt=101&fqt=1&beg=${startInt}&end=${endInt}`;
  const headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Referer": "https://quote.eastmoney.com/",
  };

  await fs.mkdir("data/raw", { recursive: true });
  await fs.mkdir("data/processed", { recursive: true });

  const csvPath = path.join("data", "processed", `${symbol}.csv`);
  const rawPath = path.join("data", "raw", `${symbol}.json`);

  if (!force) {
    try {
      const st = await fs.stat(csvPath);
      if (st.size > 0) {
        console.log(`[data] cache hit: ${csvPath} (${(st.size/1024).toFixed(1)} KB)`);
        return csvPath;
      }
    } catch {}
  }

  console.log(`[data] GET ${name} (${symbol}.${exchange}) ${start} → ${end}`);
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  const json = await res.json();
  if (!json.data || !Array.isArray(json.data.klines)) {
    throw new Error(`Unexpected response: ${JSON.stringify(json).slice(0, 300)}`);
  }
  await fs.writeFile(rawPath, JSON.stringify(json, null, 2), "utf8");
  const rows = json.data.klines.map(klineToRow);
  const header = ["date","open","close","high","low","volume","amount","amplitude","change_pct","change_amt","turnover"];
  const lines = [header.join(",")];
  for (const r of rows) lines.push(header.map(h => csvEscape(r[h])).join(","));
  await fs.writeFile(csvPath, "\uFEFF" + lines.join("\n"), "utf8");
  console.log(`[data] saved: ${csvPath} (${rows.length} bars, ${rows[0]?.date} → ${rows.at(-1)?.date})`);
  return csvPath;
}