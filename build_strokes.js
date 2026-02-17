const fs = require('fs');
const path = require('path');

const BASE = path.join(__dirname, 'mplus_stroke_data', 'mplus_stroke');

// ---- ひらがなマッピング ----
// hg1 の座標ベースファイル名 → ひらがな文字
// グリッド配置: X=行(あ行,か行...), Y=列(a,i,u,e,o + 濁点/小書き)
const HG_GRID = {
  '0950': {
    base:  ['あ','い','う','え','お'],
    small: ['ぁ','ぃ','ぅ','ぇ','ぉ'],
    extra: ['ゔ'],
  },
  '1300': {
    base:  ['か','き','く','け','こ'],
    small: ['が','ぎ','ぐ','げ','ご'],
    extra: ['ゕ','ゖ'],
  },
  '1650': {
    base:  ['さ','し','す','せ','そ'],
    small: ['ざ','じ','ず','ぜ','ぞ'],
  },
  '2000': {
    base:  ['た','ち','つ','て','と'],
    small: ['だ','ぢ','づ','で','ど'],
  },
  '2350': {
    base:  ['な','に','ぬ','ね','の'],
  },
  '2700': {
    base:  ['は','ひ','ふ','へ','ほ'],
    small: ['ば','び','ぶ','べ','ぼ'],
    extra: ['ぱ','ぴ','ぷ','ぺ','ぽ'],
  },
  '3050': {
    base:  ['ま','み','む','め','も'],
  },
  '3400': {
    base:  ['や','ゆ','よ'],
    small: ['っ','ゃ','ゅ','ょ','ゎ'],
  },
  '3750': {
    base:  ['ら','り','る','れ','ろ'],
  },
  '4100': {
    base:  ['わ','ゐ','ゑ','を','ん'],
  },
};

function parseSvgElements(svgContent) {
  const elements = [];

  // <line ... /> を抽出
  const lineRe = /<line\s[^>]*?\/>/g;
  let m;
  while ((m = lineRe.exec(svgContent)) !== null) {
    const tag = m[0];
    const x1 = parseFloat(tag.match(/x1="([^"]+)"/)?.[1] || 0);
    const y1 = parseFloat(tag.match(/y1="([^"]+)"/)?.[1] || 0);
    const x2 = parseFloat(tag.match(/x2="([^"]+)"/)?.[1] || 0);
    const y2 = parseFloat(tag.match(/y2="([^"]+)"/)?.[1] || 0);
    elements.push({ t: 'L', x1, y1, x2, y2 });
  }

  // <path d="..." /> を抽出
  const pathRe = /<path\s[^>]*?d="([^"]+)"[^>]*?\/>/g;
  while ((m = pathRe.exec(svgContent)) !== null) {
    elements.push({ t: 'P', d: m[1] });
  }

  // <polyline points="..." /> を抽出 → path の d 文字列に変換
  const polyRe = /<polyline\s[^>]*?points="([^"]+)"[^>]*?\/>/g;
  while ((m = polyRe.exec(svgContent)) !== null) {
    const nums = m[1].trim().split(/[\s,]+/).map(Number);
    if (nums.length >= 4) {
      let d = `M${nums[0]},${nums[1]}`;
      for (let i = 2; i < nums.length; i += 2) {
        d += ` L${nums[i]},${nums[i + 1]}`;
      }
      elements.push({ t: 'P', d });
    }
  }

  return elements;
}

function buildHiraganaMapping(dir) {
  const mapping = {};
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.svg')).sort();

  // ファイルを X グループごとに分類
  const groups = {};
  for (const file of files) {
    const m = file.match(/svg_(\d+)_(\d+)\.svg/);
    if (!m) continue;
    const x = m[1];
    const y = parseInt(m[2], 10);
    if (!groups[x]) groups[x] = [];
    groups[x].push({ y, file });
  }

  for (const [x, entries] of Object.entries(groups)) {
    entries.sort((a, b) => a.y - b.y);
    const grid = HG_GRID[x];
    if (!grid) continue;

    // Y 値の絶対範囲で base / small / extra を分割
    // base: Y ≤ 1400, small: 1400 < Y ≤ 1950, extra: Y > 1950
    const baseEntries  = entries.filter(e => e.y <= 1400);
    const smallEntries = entries.filter(e => e.y > 1400 && e.y <= 1950);
    const extraEntries = entries.filter(e => e.y > 1950);
    const yGroups = [baseEntries, smallEntries, extraEntries].filter(g => g.length > 0);

    const charLists = [grid.base, grid.small, grid.extra].filter(Boolean);
    for (let g = 0; g < Math.min(yGroups.length, charLists.length); g++) {
      const chars = charLists[g];
      const yEntries = yGroups[g];
      for (let i = 0; i < Math.min(chars.length, yEntries.length); i++) {
        const filePath = path.join(dir, yEntries[i].file);
        const svg = fs.readFileSync(filePath, 'utf-8');
        mapping[chars[i]] = parseSvgElements(svg);
      }
    }
  }

  return mapping;
}

function buildKatakanaMapping(dir) {
  const mapping = {};
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.svg'));
  for (const file of files) {
    const m = file.match(/uni([0-9A-F]+)\.svg/i);
    if (!m) continue;
    const codePoint = parseInt(m[1], 16);
    const char = String.fromCodePoint(codePoint);
    const filePath = path.join(dir, file);
    const svg = fs.readFileSync(filePath, 'utf-8');
    mapping[char] = parseSvgElements(svg);
  }
  return mapping;
}

function buildKanjiMapping(dirs) {
  const mapping = {};
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.svg'));
    for (const file of files) {
      const char = file.replace(/\.svg$/, '').replace(/_jp04$/, '');
      if (char.length !== 1) continue;
      const filePath = path.join(dir, file);
      const svg = fs.readFileSync(filePath, 'utf-8');
      mapping[char] = parseSvgElements(svg);
    }
  }
  return mapping;
}

// ---- Hershey ストロークフォント (欧文) ----
function buildLatinMapping(jsonPath) {
  const hershey = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  const font = hershey.futural; // Sans 1-stroke
  if (!font) throw new Error('futural font not found in hersheytext.json');

  const SCALE = 3.0;
  const Y_OFF = 11;

  const mapping = {};
  for (let ascii = 33; ascii <= 126; ascii++) {
    const glyph = font.chars[ascii - 33];
    if (!glyph || !glyph.d) continue;
    const ch = String.fromCharCode(ascii);
    const o = glyph.o;

    // 座標を変換: x' = (x - o) * SCALE + 50,  y' = y * SCALE + Y_OFF
    const transformed = glyph.d.replace(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g, (_, xs, ys) => {
      const x = parseFloat(xs);
      const y = parseFloat(ys);
      const nx = ((x - o) * SCALE + 50).toFixed(1);
      const ny = (y * SCALE + Y_OFF).toFixed(1);
      return `${nx},${ny}`;
    });

    mapping[ch] = [{ t: 'P', d: transformed }];
  }
  return mapping;
}

// ---- メイン処理 ----
console.log('Building stroke data JSON...');

const result = {};

// ひらがな (hg1)
const hg = buildHiraganaMapping(path.join(BASE, 'mplus_hg1_glyphs'));
Object.assign(result, hg);
console.log(`  Hiragana: ${Object.keys(hg).length} chars`);

// カタカナ (kk1)
const kk = buildKatakanaMapping(path.join(BASE, 'mplus_kk1_glyphs'));
Object.assign(result, kk);
console.log(`  Katakana: ${Object.keys(kk).length} chars`);

// 漢字
const kanjiDirs = [];
for (let i = 1; i <= 9; i++) {
  kanjiDirs.push(path.join(BASE, `kanji-0${i}`));
}
kanjiDirs.push(path.join(BASE, 'k2004-01'));
const kanji = buildKanjiMapping(kanjiDirs);
Object.assign(result, kanji);
console.log(`  Kanji: ${Object.keys(kanji).length} chars`);

// 欧文 (Hershey)
const hersheyPath = path.join(__dirname, 'data', 'hersheytext.json');
if (fs.existsSync(hersheyPath)) {
  const latin = buildLatinMapping(hersheyPath);
  Object.assign(result, latin);
  console.log(`  Latin (Hershey): ${Object.keys(latin).length} chars`);
} else {
  console.log('  Latin: hersheytext.json not found, skipping');
}

console.log(`  Total: ${Object.keys(result).length} chars`);

const outPath = path.join(__dirname, 'data', 'mplus_strokes.json');
fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(result));

const sizeKB = (fs.statSync(outPath).size / 1024).toFixed(1);
console.log(`Output: ${outPath} (${sizeKB} KB)`);
