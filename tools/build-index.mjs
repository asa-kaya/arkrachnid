// Parse ArknightsGameData story scripts into a compact search index.
// Usage: node tools/build-index.mjs [--lang en]
// Output: data/meta.json, data/lines.json

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const langArg = process.argv.indexOf('--lang');
const LANG = langArg > -1 ? process.argv[langArg + 1] : 'en';
const GD = path.join(ROOT, 'ArknightsGamedata', LANG, 'gamedata');
const STORY_DIR = path.join(GD, 'story');
const INFO_DIR = path.join(STORY_DIR, '[uc]info');
const OUT_DIR = path.join(ROOT, 'data');

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const t0 = Date.now();

// ---------- tables ----------
const reviewTable = readJson(path.join(GD, 'excel', 'story_review_table.json'));
const charTable = readJson(path.join(GD, 'excel', 'character_table.json'));
let activityNames = {};
try {
  const act = readJson(path.join(GD, 'excel', 'activity_table.json'));
  for (const [id, info] of Object.entries(act.basicInfo || {})) activityNames[id.toLowerCase()] = info.name;
} catch { /* optional */ }

const charName = {}; // char id -> name
for (const [id, c] of Object.entries(charTable)) if (c && c.name) charName[id.toLowerCase()] = c.name;

// record token (e.g. "ela" in story_ela_1_1) -> operator name
const charByToken = {};
for (const id of Object.keys(charName)) {
  const m = id.match(/^char_\d+_(.+)$/);
  if (m) charByToken[m[1]] = charName[id];
}

// ---------- groups & catalogued stories ----------
const CAT = { MAINLINE: 'main', ACTIVITY: 'event', MINI_ACTIVITY: 'mini', NONE: 'record' };
const groups = []; // {id, name, cat, start, op}
const groupIdx = new Map();
const storyByPath = new Map(); // lowercase rel path (no ext) -> story meta

function addGroup(id, name, cat, start = 0, extra = {}) {
  if (groupIdx.has(id)) return groupIdx.get(id);
  groups.push({ id, name, cat, start, ...extra });
  groupIdx.set(id, groups.length - 1);
  return groups.length - 1;
}

for (const g of Object.values(reviewTable)) {
  const cat = CAT[g.entryType] || 'other';
  let op;
  if (cat === 'record') {
    const txt = g.infoUnlockDatas?.[0]?.storyTxt || '';
    const m = txt.match(/story_([^_/]+)_\d+_\d+$/);
    if (m) op = charByToken[m[1].toLowerCase()];
  }
  const gi = addGroup(g.id, g.name || g.id, cat, g.startTime > 0 ? g.startTime : 0, op ? { op } : {});
  for (const s of g.infoUnlockDatas || []) {
    if (!s.storyTxt) continue;
    const key = s.storyTxt.toLowerCase();
    if (storyByPath.has(key)) continue;
    storyByPath.set(key, {
      g: gi,
      code: s.storyCode || '',
      name: s.storyName || '',
      tag: s.avgTag || '',
      sort: s.storySort ?? 0,
      info: s.storyInfo || '',
    });
  }
}

// ---------- walk story files ----------
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (p === INFO_DIR) continue;
      walk(p, out);
    } else if (e.name.endsWith('.txt') && !/report/i.test(e.name)) out.push(p);
  }
  return out;
}
const files = walk(STORY_DIR);

// ---------- portrait handling ----------
const portraits = []; // {key, name, inferred}
const portraitIdx = new Map();
const coSpeak = []; // per portrait: Map speaker -> count

function resolvePortrait(raw) {
  if (!raw) return -1;
  let id = raw.replace(/[#$].*$/, '').trim().toLowerCase();
  if (!id || id === 'char_empty' || id === 'none') return -1;
  // collapse expression/variant suffixes: char_002_amiya_1 -> char_002_amiya, avg_npc_394_1 -> avg_npc_394
  const cands = [id];
  let base = id;
  while (base.split('_').length > 3 && /_(\d+|ex)$/.test(base)) {
    base = base.replace(/_(\d+|ex)$/, '');
    cands.push(base);
  }
  // also try dropping any trailing segment (e.g. char_405_absin_ed -> char_405_absin)
  for (let b = id; b.split('_').length > 3; ) { b = b.replace(/_[^_]+$/, ''); cands.push(b); }
  for (const c of [...cands]) if (c.startsWith('avg_')) cands.push('char_' + c.slice(4));
  let key = base, name = '';
  for (const c of cands) if (charName[c]) { key = c; name = charName[c]; break; }
  let i = portraitIdx.get(key);
  if (i === undefined) {
    i = portraits.length;
    portraits.push({ key, name, inferred: false });
    portraitIdx.set(key, i);
    coSpeak.push(new Map());
  }
  return i;
}

// ---------- parsing helpers ----------
function splitTag(line) {
  // returns [tagInner, rest] for lines like [cmd(a="x]")] rest ; respects quotes
  let q = null;
  for (let i = 1; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === q) q = null; }
    else if (ch === '"') q = ch;
    else if (ch === ']') return [line.slice(1, i), line.slice(i + 1)];
  }
  return [line.slice(1), ''];
}

function parseTag(inner) {
  const m = inner.match(/^\s*([A-Za-z_]+)\s*(\(([\s\S]*)\))?\s*$/);
  const attrs = {};
  let cmd;
  if (m && !/^\s*name\s*=/.test(inner)) {
    cmd = m[1].toLowerCase();
    if (m[3] !== undefined) readAttrs(m[3], attrs);
  } else {
    cmd = 'name';
    readAttrs(inner, attrs);
  }
  return { cmd, attrs };
}

function readAttrs(s, attrs) {
  const re = /([A-Za-z_][\w]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^,\s)]+))/g;
  let m;
  while ((m = re.exec(s))) attrs[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4];
}

const clean = (t) =>
  t.replace(/\\n/g, ' ')
    .replace(/<\/?[a-zA-Z][^>]*>|<\/>|<p=\d+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// row kinds
const K = { DIALOG: 0, NARR: 1, CAPTION: 2, CHOICE: 3, SYSTEM: 4, TITLE: 5 };
const TEXT_CMDS = new Set(['name', 'multiline', 'narration', 'popupdialog', 'tutorial', 'animtext', 'dialog', 'interlude', 'div']);
const SLOT = { l: 'l', left: 'l', m: 'm', middle: 'm', mid: 'm', r: 'r', right: 'r' };

function parseStory(text) {
  const rows = [];
  // portrait state: slot -> portrait idx; focus = slot key or null
  let slots = {};
  let focus = null;
  const current = () => Object.values(slots).filter((x) => x >= 0);
  const focused = () => {
    if (focus && slots[focus] >= 0) return slots[focus];
    const c = current();
    return c.length === 1 ? c[0] : -1;
  };
  const push = (kind, speaker, t) => {
    t = clean(t);
    if (!t) return;
    const row = [kind, speaker || '', t];
    const p = [...new Set(current())];
    if (p.length) row.push(p);
    rows.push(row);
    if (kind === K.DIALOG && speaker) {
      const f = focused();
      if (f >= 0) {
        const m = coSpeak[f];
        m.set(speaker, (m.get(speaker) || 0) + 1);
      }
    }
  };

  for (let line of text.split(/\r?\n/)) {
    line = line.trim();
    if (!line) continue;
    if (line[0] !== '[') { push(K.NARR, '', line); continue; }
    const [inner, rest] = splitTag(line);
    const { cmd, attrs } = parseTag(inner);

    switch (cmd) {
      case 'character': {
        slots = {};
        focus = null;
        if (attrs.name) slots['1'] = resolvePortrait(attrs.name);
        if (attrs.name2) slots['2'] = resolvePortrait(attrs.name2);
        if (attrs.focus === '1' || attrs.focus === '2') focus = attrs.focus;
        break;
      }
      case 'charslot': {
        const slot = SLOT[(attrs.slot || '').toLowerCase()];
        if (!slot && !attrs.name) { slots = {}; focus = null; break; }
        if (slot && attrs.name) slots[slot] = resolvePortrait(attrs.name);
        else if (slot && attrs.focus === undefined) delete slots[slot];
        if (attrs.focus !== undefined) focus = SLOT[attrs.focus.toLowerCase()] || null;
        // Character() used slots '1'/'2'; drop them when charslot takes over
        delete slots['1']; delete slots['2'];
        break;
      }
      case 'subtitle':
      case 'sticker':
        if (attrs.text) push(K.CAPTION, '', attrs.text);
        break;
      case 'decision':
        if (attrs.options) for (const o of attrs.options.split(';')) push(K.CHOICE, 'Doctor', o);
        break;
      default:
        if (TEXT_CMDS.has(cmd) && rest.trim()) {
          if (cmd === 'name' || cmd === 'multiline') push(K.DIALOG, clean(attrs.name || ''), rest);
          else if (cmd === 'popupdialog' || cmd === 'tutorial') push(K.SYSTEM, '', rest);
          else if (cmd === 'animtext') push(K.TITLE, '', rest.replace(/<\/>/g, ' · '));
          else push(K.NARR, '', rest);
        }
    }
  }
  return rows;
}

// ---------- build ----------
const stories = [];
const lines = [];
const speakerCount = new Map();
let rowTotal = 0;

for (const file of files) {
  const rel = path.relative(STORY_DIR, file).replace(/\\/g, '/');
  const key = rel.replace(/\.txt$/i, '').toLowerCase();
  let meta = storyByPath.get(key);
  if (!meta) {
    const parts = rel.split('/');
    const dirParts = parts.slice(0, -1);
    let gid, gname;
    if (dirParts[0] === 'activities' && dirParts[1]) {
      gid = 'x:' + dirParts.slice(0, 2).join('/');
      gname = activityNames[dirParts[1].toLowerCase()] || dirParts[1];
    } else {
      gid = 'x:' + dirParts.slice(0, 2).join('/');
      gname = dirParts.slice(1).join(' / ') || dirParts.join('/');
    }
    meta = {
      g: addGroup(gid, gname, 'other', 0, { folder: dirParts.join('/') }),
      code: '',
      name: parts.at(-1).replace(/\.txt$/i, ''),
      tag: '',
      sort: 0,
      info: '',
    };
  }
  const rows = parseStory(fs.readFileSync(file, 'utf8'));
  if (!rows.length) continue;
  let sum = '';
  if (meta.info) {
    const ip = path.join(STORY_DIR, '[uc]' + meta.info + '.txt');
    try { sum = clean(fs.readFileSync(ip, 'utf8')); } catch { /* missing */ }
  }
  for (const r of rows) if (r[0] === K.DIALOG && r[1]) speakerCount.set(r[1], (speakerCount.get(r[1]) || 0) + 1);
  rowTotal += rows.length;
  stories.push({ g: meta.g, code: meta.code, name: meta.name, tag: meta.tag, sort: meta.sort, path: rel, sum, rows });
}

// ---------- infer names for unnamed portraits ----------
const NOISE = /^(\?+|…+|\.+|doctor|dr\.?|.*\?\?\?.*)$/i;
let inferredCount = 0;
portraits.forEach((p, i) => {
  if (p.name) return;
  const counts = [...coSpeak[i].entries()].filter(([s]) => !NOISE.test(s)).sort((a, b) => b[1] - a[1]);
  const total = counts.reduce((n, [, c]) => n + c, 0);
  if (counts.length && counts[0][1] >= 3 && counts[0][1] / total >= 0.4) {
    p.name = counts[0][0];
    p.inferred = true;
    inferredCount++;
  }
});

// ---------- order ----------
const catOrder = { main: 0, event: 1, mini: 2, record: 3, other: 4 };
const natural = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
const groupOrder = groups.map((_, i) => i).sort((a, b) => {
  const A = groups[a], B = groups[b];
  if (catOrder[A.cat] !== catOrder[B.cat]) return catOrder[A.cat] - catOrder[B.cat];
  if (A.cat === 'event' || A.cat === 'mini') if (A.start !== B.start) return A.start - B.start;
  if (A.cat === 'record') return natural.compare((A.op || '') + A.name, (B.op || '') + B.name);
  return natural.compare(A.cat === 'main' ? A.id : A.name, B.cat === 'main' ? B.id : B.name);
});
const groupRank = new Map(groupOrder.map((g, r) => [g, r]));
stories.sort((a, b) => groupRank.get(a.g) - groupRank.get(b.g) || a.sort - b.sort || natural.compare(a.path, b.path));

// remap group indices to sorted order and drop empty groups
const used = new Set(stories.map((s) => s.g));
const newIdx = new Map();
const outGroups = [];
for (const g of groupOrder) if (used.has(g)) { newIdx.set(g, outGroups.length); outGroups.push(groups[g]); }

const outStories = stories.map((s) => {
  const o = { g: newIdx.get(s.g), path: s.path, n: s.rows.length };
  if (s.code) o.code = s.code;
  if (s.name) o.name = s.name;
  if (s.tag) o.tag = s.tag;
  if (s.sum) o.sum = s.sum;
  return o;
});
for (const s of stories) lines.push(s.rows);

const meta = {
  built: new Date().toISOString(),
  lang: LANG,
  kinds: ['dialog', 'narration', 'caption', 'choice', 'system', 'title'],
  groups: outGroups.map(({ id, name, cat, start, op, folder }) => {
    const g = { id, name, cat };
    if (start) g.start = start;
    if (op) g.op = op;
    if (folder) g.folder = folder;
    return g;
  }),
  stories: outStories,
  portraits: portraits.map((p) => (p.inferred ? [p.key, p.name, 1] : [p.key, p.name])),
  speakers: [...speakerCount.entries()].sort((a, b) => b[1] - a[1]),
};

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, 'meta.json'), JSON.stringify(meta));
fs.writeFileSync(path.join(OUT_DIR, 'lines.json'), JSON.stringify(lines));

const size = (f) => (fs.statSync(path.join(OUT_DIR, f)).size / 1048576).toFixed(1) + ' MB';
console.log(`files scanned   ${files.length}`);
console.log(`stories indexed ${stories.length} in ${outGroups.length} groups`);
console.log(`rows            ${rowTotal}`);
console.log(`speakers        ${speakerCount.size}`);
console.log(`portraits       ${portraits.length} (${portraits.filter((p) => p.name && !p.inferred).length} named, ${inferredCount} inferred)`);
console.log(`meta.json       ${size('meta.json')}`);
console.log(`lines.json      ${size('lines.json')}`);
console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
