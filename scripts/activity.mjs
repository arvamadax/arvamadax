#!/usr/bin/env node
// Membuat kartu keaktifan GitHub (angka + heatmap harian) sebagai SVG terang dan gelap.
// Dijalankan harian oleh .github/workflows/activity.yml; hasilnya dipublikasikan ke branch `output`.
//
//   node scripts/activity.mjs [folder-keluaran]      (bawaan: dist)
//   GITHUB_TOKEN=… node scripts/activity.mjs         (opsional, batas API lebih longgar)
import fs from "node:fs";
import path from "node:path";

const USER = "arvamadax";
const OUT = process.argv[2] || "dist";
const H = { "User-Agent": USER, Accept: "application/vnd.github+json", ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}) };

const THEME = {
  light: { ink: "#131416", muted: "#5b5e63", line: "#dcddda", empty: "#ebecea", accent: ["#c9d2f3", "#94a8ea", "#5c79dc", "#2447c9"] },
  dark: { ink: "#e8e9eb", muted: "#9a9ea5", line: "#2a2c31", empty: "#1c1e22", accent: ["#26315e", "#3d51a3", "#6581e6", "#8aa2ff"] },
};

async function json(url) {
  const r = await fetch(url, { headers: H, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.json();
}

// <td data-date="2026-04-26" id="contribution-day-component-…"> + <tool-tip for="…">6 contributions on April 26th.</tool-tip>
async function tahun(y) {
  const r = await fetch(`https://github.com/users/${USER}/contributions?from=${y}-01-01&to=${y}-12-31`, { headers: { "User-Agent": USER }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`contributions ${y}: HTTP ${r.status}`);
  const html = await r.text();
  const tanggal = new Map([...html.matchAll(/data-date="(\d{4}-\d{2}-\d{2})"\s+id="([^"]+)"/g)].map((m) => [m[2], m[1]]));
  const hari = {};
  for (const m of html.matchAll(/<tool-tip[^>]*\bfor="([^"]+)"[^>]*>([^<]*)<\/tool-tip>/g)) {
    const d = tanggal.get(m[1]);
    if (d) hari[d] = /^(\d+)/.test(m[2]) ? +m[2].match(/^(\d+)/)[1] : 0;
  }
  if (!Object.keys(hari).length) throw new Error(`contributions ${y}: format halaman berubah`);
  return hari;
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const bulan = (iso) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });

function svg(days, stats, t) {
  // tingkat warna = kuartil hari yang ada kontribusinya (cara GitHub)
  const isi = days.map((d) => d.count).filter(Boolean).sort((a, b) => a - b);
  const q = [0.25, 0.5, 0.75].map((p) => isi[Math.floor(p * (isi.length - 1))] || 1);
  const warna = (c) => (c === 0 ? t.empty : t.accent[c <= q[0] ? 0 : c <= q[1] ? 1 : c <= q[2] ? 2 : 3]);

  const pad = new Date(days[0].date + "T00:00:00Z").getUTCDay(); // kolom dimulai hari Minggu
  const sel = [...Array(pad).fill(null), ...days];
  const minggu = Math.ceil(sel.length / 7);
  const C = 11, G = 3, X0 = 24, Y0 = 118;
  const W = Math.max(X0 * 2 + minggu * (C + G), 760), Hh = Y0 + 7 * (C + G) + 34;

  const kotak = sel.map((d, k) => d && `<rect x="${X0 + Math.floor(k / 7) * (C + G)}" y="${Y0 + (k % 7) * (C + G)}" width="${C}" height="${C}" rx="2" fill="${warna(d.count)}"><title>${d.count} on ${d.date}</title></rect>`).filter(Boolean).join("");
  let prev = "";
  const label = [];
  for (let w = 0; w < minggu; w++) {
    const d = sel.slice(w * 7, w * 7 + 7).find(Boolean);
    if (d && d.date.slice(0, 7) !== prev) { prev = d.date.slice(0, 7); label.push(`<text x="${X0 + w * (C + G)}" y="${Y0 - 8}" class="m">${bulan(d.date)}</text>`); }
  }
  const angka = [["Contributions", stats.total.toLocaleString("en-US")], ["Active days", stats.active], ["Longest streak", `${stats.longest} days`], ["Public repositories", stats.repos]]
    .map(([k, v], n) => `<g transform="translate(${X0 + n * 180},30)"><text class="m">${k}</text><text y="30" class="v">${esc(v)}</text></g>`).join("");
  const skala = [t.empty, ...t.accent].map((c, n) => `<rect x="${W - X0 - 150 + 38 + n * 14}" y="${Hh - 22}" width="${C}" height="${C}" rx="2" fill="${c}"/>`).join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${Hh}" viewBox="0 0 ${W} ${Hh}" role="img" aria-label="${stats.total} GitHub contributions since ${stats.since}">
<style>text{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;fill:${t.muted};font-size:12px}.v{fill:${t.ink};font-size:24px;font-weight:600;letter-spacing:-.02em}.s{font-size:11px}</style>
<rect x=".5" y=".5" width="${W - 1}" height="${Hh - 1}" rx="6" fill="none" stroke="${t.line}"/>
${angka}
<line x1="${X0}" x2="${W - X0}" y1="84" y2="84" stroke="${t.line}"/>
${label.join("")}
${kotak}
<text x="${X0}" y="${Hh - 13}" class="s">Since ${esc(stats.sinceLabel)} · updated ${esc(stats.updated)}</text>
<text x="${W - X0 - 150}" y="${Hh - 13}" class="s">Less</text>${skala}<text x="${W - X0}" y="${Hh - 13}" class="s" text-anchor="end">More</text>
</svg>`;
}

try {
  const user = await json(`https://api.github.com/users/${USER}`);
  const mulai = user.created_at.slice(0, 10);
  const hariIni = new Date().toISOString().slice(0, 10);
  const semua = {};
  for (let y = +mulai.slice(0, 4); y <= +hariIni.slice(0, 4); y++) Object.assign(semua, await tahun(y));
  const days = Object.entries(semua).filter(([d]) => d >= mulai && d <= hariIni).sort().map(([date, count]) => ({ date, count }));

  let longest = 0, run = 0;
  for (const d of days) { run = d.count ? run + 1 : 0; longest = Math.max(longest, run); }
  const stats = {
    total: days.reduce((n, d) => n + d.count, 0),
    active: days.filter((d) => d.count).length,
    longest,
    repos: user.public_repos,
    since: mulai,
    sinceLabel: new Date(mulai + "T00:00:00Z").toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }),
    updated: new Date().toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Jakarta" }),
  };

  fs.mkdirSync(OUT, { recursive: true });
  for (const [nama, t] of Object.entries(THEME)) fs.writeFileSync(path.join(OUT, `activity-${nama}.svg`), svg(days, stats, t));
  console.log(`activity: ${stats.total} contributions, ${stats.active} active days, ${days.length} days → ${OUT}/`);
} catch (e) {
  console.error(`activity gagal: ${e.message}`);
  process.exit(1); // Action gagal = SVG lama di branch output tetap dipakai
}
