#!/usr/bin/env node
// Generates hand-styled SVG stat cards from the GitHub GraphQL API.
// Usage: GITHUB_TOKEN=... node scripts/gen-stats.mjs --out dist

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const LOGIN = 'chevgan';
const FEATURED = ['render-peek', 'react-ai-voice-visualizer'];
const OUT = process.argv.includes('--out')
  ? process.argv[process.argv.indexOf('--out') + 1]
  : 'dist';

const TOKEN = process.env.GITHUB_TOKEN;
if (!TOKEN) { console.error('GITHUB_TOKEN is required'); process.exit(1); }

const THEMES = {
  dark: {
    suffix: 'dark',
    bg: '#0d1117', card: '#161b22', border: '#30363d',
    text: '#c9d1d9', dim: '#8b949e', accent: '#7ee787',
    grad: ['#22d3ee', '#818cf8', '#e879f9'],
  },
  light: {
    suffix: 'light',
    bg: '#ffffff', card: '#f6f8fa', border: '#d0d7de',
    text: '#24292f', dim: '#57606a', accent: '#1a7f37',
    grad: ['#0891b2', '#6366f1', '#c026d3'],
  },
};

const esc = s => String(s ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&apos;');

const fmt = n => n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : String(n);

function wrap(text, width, maxLines) {
  const words = String(text ?? '').split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const w of words) {
    if ((line + ' ' + w).trim().length > width) {
      lines.push(line.trim());
      line = w;
      if (lines.length === maxLines) break;
    } else line = (line + ' ' + w).trim();
  }
  if (lines.length < maxLines && line) lines.push(line.trim());
  if (words.join(' ').length > width * maxLines && lines.length === maxLines) {
    lines[maxLines - 1] = lines[maxLines - 1].replace(/.{3}$/, '') + '…';
  }
  return lines;
}

async function gql(query, variables) {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: `bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

const data = await gql(`
  query($login: String!) {
    user(login: $login) {
      followers { totalCount }
      pullRequests { totalCount }
      issues { totalCount }
      contributionsCollection { contributionCalendar { totalContributions } }
      repositories(first: 100, ownerAffiliations: OWNER, isFork: false, privacy: PUBLIC) {
        totalCount
        nodes {
          name stargazerCount forkCount description
          primaryLanguage { name color }
          languages(first: 10, orderBy: { field: SIZE, direction: DESC }) {
            edges { size node { name color } }
          }
        }
      }
    }
  }`, { login: LOGIN });

const u = data.user;
const repos = u.repositories.nodes;
const totalStars = repos.reduce((s, r) => s + r.stargazerCount, 0);

const langBytes = new Map();
for (const r of repos)
  for (const e of r.languages.edges) {
    const cur = langBytes.get(e.node.name) ?? { size: 0, color: e.node.color };
    cur.size += e.size;
    langBytes.set(e.node.name, cur);
  }
const totalBytes = [...langBytes.values()].reduce((s, l) => s + l.size, 0);
const topLangs = [...langBytes.entries()]
  .map(([name, { size, color }]) => ({ name, color: color ?? '#8b949e', pct: (size / totalBytes) * 100 }))
  .sort((a, b) => b.pct - a.pct)
  .slice(0, 6);

const defs = t => `
  <defs>
    <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${t.grad[0]}"/>
      <stop offset="50%" stop-color="${t.grad[1]}"/>
      <stop offset="100%" stop-color="${t.grad[2]}"/>
    </linearGradient>
    <linearGradient id="gb" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${t.grad[0]}" stop-opacity="0.5"/>
      <stop offset="50%" stop-color="${t.grad[1]}" stop-opacity="0.2"/>
      <stop offset="100%" stop-color="${t.grad[2]}" stop-opacity="0.5"/>
    </linearGradient>
  </defs>
  <style>
    .b { font-family: 'Segoe UI', Ubuntu, sans-serif; }
    .m { font-family: 'SFMono-Regular', Consolas, Menlo, monospace; }
    .row { opacity: 0; animation: fin 0.5s ease-out forwards; }
    ${[0, 1, 2, 3, 4, 5].map(i => `.r${i} { animation-delay: ${0.15 + i * 0.12}s; }`).join(' ')}
    @keyframes fin { to { opacity: 1; } }
    .bar { transform: scaleX(0); transform-origin: 24px 0; animation: grow 1s ease-out 0.3s forwards; }
    @keyframes grow { to { transform: scaleX(1); } }
    .pulse { animation: pulse 2.4s ease-in-out infinite; }
    @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.25; } }
  </style>`;

const shell = (t, w, h, body) => `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" fill="none" xmlns="http://www.w3.org/2000/svg">
${defs(t)}
  <rect x="1" y="1" width="${w - 2}" height="${h - 2}" rx="14" fill="${t.bg}"/>
  <rect x="1" y="1" width="${w - 2}" height="${h - 2}" rx="14" stroke="url(#gb)" stroke-width="1.5"/>
${body}
</svg>`;

function statsCard(t) {
  const rows = [
    ['★', 'Total stars', fmt(totalStars)],
    ['◆', `Contributions ${new Date().getFullYear()}`, fmt(u.contributionsCollection.contributionCalendar.totalContributions)],
    ['⇅', 'Pull requests', fmt(u.pullRequests.totalCount)],
    ['◉', 'Issues', fmt(u.issues.totalCount)],
    ['▣', 'Public repos', fmt(u.repositories.totalCount)],
    ['●', 'Followers', fmt(u.followers.totalCount)],
  ];
  const body = `
  <text x="24" y="38" class="b" font-size="17" font-weight="700" fill="url(#g)">chevgan — github stats</text>
  <circle cx="416" cy="33" r="4" fill="${t.accent}" class="pulse"/>
  ${rows.map(([ic, label, val], i) => `
  <g class="row r${i}">
    <text x="26" y="${72 + i * 26}" class="m" font-size="14" fill="url(#g)">${ic}</text>
    <text x="52" y="${72 + i * 26}" class="b" font-size="14" fill="${t.dim}">${label}</text>
    <text x="416" y="${72 + i * 26}" text-anchor="end" class="m" font-size="14" font-weight="700" fill="${t.text}">${val}</text>
  </g>`).join('')}`;
  return shell(t, 440, 240, body);
}

function langsCard(t) {
  let x = 24;
  const segs = topLangs.map(l => {
    const w = Math.max(6, (l.pct / 100) * 392);
    const s = `<rect x="${x}" y="56" width="${w}" height="10" fill="${l.color}"/>`;
    x += w;
    return s;
  }).join('');
  const legend = topLangs.map((l, i) => {
    const col = i % 2, row = Math.floor(i / 2);
    return `
  <g class="row r${i}">
    <circle cx="${32 + col * 200}" cy="${96 + row * 28}" r="5" fill="${l.color}"/>
    <text x="${46 + col * 200}" y="${101 + row * 28}" class="b" font-size="13" fill="${t.text}">${esc(l.name)}</text>
    <text x="${180 + col * 200}" y="${101 + row * 28}" text-anchor="end" class="m" font-size="12" fill="${t.dim}">${l.pct.toFixed(1)}%</text>
  </g>`;
  }).join('');
  const body = `
  <text x="24" y="38" class="b" font-size="17" font-weight="700" fill="url(#g)">most used languages</text>
  <g class="bar">${segs}</g>
  <rect x="24" y="56" width="392" height="10" rx="5" fill="none" stroke="${t.border}"/>
  ${legend}`;
  return shell(t, 440, 200, body);
}

function pinCard(t, repo) {
  const r = repos.find(x => x.name === repo);
  if (!r) return null;
  const desc = wrap(r.description ?? '', 56, 2);
  const lang = r.primaryLanguage;
  const body = `
  <text x="24" y="36" class="m" font-size="16" font-weight="700" fill="url(#g)">${esc(r.name)}</text>
  ${desc.map((line, i) => `<text x="24" y="${62 + i * 20}" class="b row r${i}" font-size="13" fill="${t.dim}">${esc(line)}</text>`).join('')}
  ${lang ? `<circle cx="30" cy="116" r="5" fill="${lang.color ?? t.dim}"/>
  <text x="42" y="121" class="b" font-size="13" fill="${t.text}">${esc(lang.name)}</text>` : ''}
  <text x="330" y="121" class="m" font-size="13" fill="${t.dim}">★ ${fmt(r.stargazerCount)}</text>
  <text x="386" y="121" class="m" font-size="13" fill="${t.dim}">⑂ ${fmt(r.forkCount)}</text>`;
  return shell(t, 440, 140, body);
}

mkdirSync(OUT, { recursive: true });
for (const t of Object.values(THEMES)) {
  writeFileSync(join(OUT, `stats-${t.suffix}.svg`), statsCard(t));
  writeFileSync(join(OUT, `langs-${t.suffix}.svg`), langsCard(t));
  for (const repo of FEATURED) {
    const svg = pinCard(t, repo);
    if (svg) writeFileSync(join(OUT, `pin-${repo}-${t.suffix}.svg`), svg);
  }
}
console.log(`Cards written to ${OUT}/`);
