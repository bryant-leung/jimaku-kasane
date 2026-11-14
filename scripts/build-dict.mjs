#!/usr/bin/env node
/**
 * Builds the offline dictionary the extension uses for word lookup:
 *   JMdict (EDRDG, CC BY-SA 4.0) via jmdict-simplified, English glosses
 *   + JLPT levels (Jonathan Waller's lists via stephenmk/yomitan-jlpt-vocab, CC BY-SA 4.0)
 *   + word frequencies (wordfreq by Robyn Speer, data CC BY-SA 4.0), lemmatized with kuromoji
 *
 * Output (not committed): extension/public/dict/
 *   forms/<n>.json.gz    form → entry ids, bucketed by the form's first character
 *   entries/<n>.json.gz  id → compact entry, bucketed by id
 *   freq/<n>.json.gz     dictionary form → Zipf frequency × 10 (7 = "the", 1 = very rare)
 *   meta.json         versions + credits
 *
 * Downloads are cached in data/cache/dict/. Skips work if the output is already current.
 * Run: npm run dict        (npm run build runs it first)
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { gunzipSync, gzipSync } from 'node:zlib';

const require = createRequire(import.meta.url);

const ROOT = path.resolve(import.meta.dirname, '..');
const CACHE = path.join(ROOT, 'data/cache/dict');
const OUT = path.join(ROOT, 'extension/public/dict');
const FORM_BUCKETS = 1024;
const ENTRY_BUCKETS = 512;
const MAX_SENSES = 5;
const MAX_GLOSSES = 4;
const MAX_EXAMPLES = 2;
const KANJI_RE = /[\u3400-\u9fff]/;
const BUILD_VERSION = 8; // bump when the output format changes

const WORDFREQ = 'https://pypi.org/pypi/wordfreq/json';

/** Minimal MessagePack decoder: enough for wordfreq's word lists (arrays, maps, strings, ints). */
function unpack(buf) {
  let at = 0;
  const str = (n) => {
    const s = buf.toString('utf8', at, at + n);
    at += n;
    return s;
  };
  const arr = (n) => Array.from({ length: n }, () => read());
  const map = (n) => Object.fromEntries(Array.from({ length: n }, () => [read(), read()]));
  function read() {
    const b = buf[at++];
    if (b <= 0x7f) return b;
    if (b >= 0x80 && b <= 0x8f) return map(b & 0x0f);
    if (b >= 0x90 && b <= 0x9f) return arr(b & 0x0f);
    if (b >= 0xa0 && b <= 0xbf) return str(b & 0x1f);
    if (b >= 0xe0) return b - 0x100;
    switch (b) {
      case 0xc0: return null;
      case 0xc2: return false;
      case 0xc3: return true;
      case 0xcc: return buf[at++];
      case 0xcd: { const v = buf.readUInt16BE(at); at += 2; return v; }
      case 0xce: { const v = buf.readUInt32BE(at); at += 4; return v; }
      case 0xd0: { const v = buf.readInt8(at); at += 1; return v; }
      case 0xd1: { const v = buf.readInt16BE(at); at += 2; return v; }
      case 0xd2: { const v = buf.readInt32BE(at); at += 4; return v; }
      case 0xd9: return str(buf[at++]);
      case 0xda: { const n = buf.readUInt16BE(at); at += 2; return str(n); }
      case 0xdb: { const n = buf.readUInt32BE(at); at += 4; return str(n); }
      case 0xdc: { const n = buf.readUInt16BE(at); at += 2; return arr(n); }
      case 0xdd: { const n = buf.readUInt32BE(at); at += 4; return arr(n); }
      case 0xde: { const n = buf.readUInt16BE(at); at += 2; return map(n); }
      case 0xdf: { const n = buf.readUInt32BE(at); at += 4; return map(n); }
      default: throw new Error(`msgpack: unsupported type 0x${b.toString(16)}`);
    }
  }
  return read();
}

/**
 * Japanese word frequencies (wordfreq's "large" list: subtitles, Wikipedia, books, web, Twitter),
 * summed per dictionary form with kuromoji, so 頑張る counts 頑張っ, 頑張り… too.
 * Returns form → Zipf × 10.
 */
async function buildFrequencies() {
  const info = await (await fetch(WORDFREQ, { headers: { 'User-Agent': 'jimaku-kasane-build' } })).json();
  const wheel = info.urls.find((u) => u.filename.endsWith('.whl'));
  const whl = path.join(CACHE, wheel.filename);
  await download(wheel.url, whl);
  const packed = execFileSync('unzip', ['-p', whl, 'wordfreq/data/large_ja.msgpack.gz'], { maxBuffer: 1 << 30 });
  // cBpack: [header, words at 0 cB, words at -1 cB, …]: Zipf = 9 − i/100 for list i (1-based).
  const lists = unpack(gunzipSync(packed));
  const { default: kuromoji } = await import('kuromoji');
  const tokenizer = await new Promise((resolve, reject) =>
    kuromoji.builder({ dicPath: path.join(path.dirname(require.resolve('kuromoji/package.json')), 'dict') }).build((e, t) => (e ? reject(e) : resolve(t))),
  );
  const sums = new Map();
  for (let i = 1; i < lists.length; i++) {
    const f = 10 ** (9 - (i - 1) / 100);
    for (const word of lists[i]) {
      const toks = tokenizer.tokenize(word);
      const key = toks.length === 1 && toks[0].basic_form !== '*' ? toks[0].basic_form : word;
      sums.set(key, (sums.get(key) ?? 0) + f);
    }
  }
  return new Map([...sums].map(([k, f]) => [k, Math.round(Math.log10(f) * 10)]));
}

const JMDICT_RELEASE = 'https://api.github.com/repos/scriptin/jmdict-simplified/releases/latest';
const JLPT = (n) => `https://raw.githubusercontent.com/stephenmk/yomitan-jlpt-vocab/main/original_data/n${n}.csv`;

async function download(url, file) {
  if (existsSync(file)) return;
  const res = await fetch(url, { headers: { 'User-Agent': 'jimaku-kasane-build' } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
}

/** Waller CSV: jmdict_seq,kana,kanji,waller_definition → id → easiest level (5 = N5). */
function parseJlpt(csv, level, into) {
  for (const line of csv.split('\n').slice(1)) {
    const id = line.split(',')[0]?.trim();
    if (id && /^\d+$/.test(id)) into.set(id, Math.max(into.get(id) ?? 0, level));
  }
}

async function main() {
  mkdirSync(CACHE, { recursive: true });
  const metaFile = path.join(OUT, 'meta.json');
  let release;
  try {
    release = await (await fetch(JMDICT_RELEASE, { headers: { 'User-Agent': 'jimaku-kasane-build' } })).json();
  } catch (e) {
    if (existsSync(metaFile)) return console.log('dict: offline, keeping the existing dictionary');
    throw e;
  }
  // The edition with Tatoeba (Tanaka corpus) example sentences linked to each meaning.
  const asset = release.assets?.find((a) => /^jmdict-examples-eng-[\d.]+.*\.json\.tgz$/.test(a.name));
  if (!asset) throw new Error('jmdict-examples-eng asset not found in the latest jmdict-simplified release');
  const meta = { buildVersion: BUILD_VERSION, jmdict: release.tag_name };
  if (existsSync(metaFile) && JSON.parse(readFileSync(metaFile, 'utf8')).jmdict === meta.jmdict &&
      JSON.parse(readFileSync(metaFile, 'utf8')).buildVersion === BUILD_VERSION) {
    console.log(`dict: up to date (${meta.jmdict})`);
    return;
  }

  const tgz = path.join(CACHE, asset.name);
  await download(asset.browser_download_url, tgz);
  const unpacked = path.join(CACHE, 'unpacked');
  rmSync(unpacked, { recursive: true, force: true });
  mkdirSync(unpacked);
  execFileSync('tar', ['xzf', tgz, '-C', unpacked]);
  const json = readdirSync(unpacked).find((f) => f.endsWith('.json'));
  const jmdict = JSON.parse(readFileSync(path.join(unpacked, json), 'utf8'));

  const jlpt = new Map();
  for (const n of [1, 2, 3, 4, 5]) {
    const file = path.join(CACHE, `n${n}.csv`);
    await download(JLPT(n), file);
    parseJlpt(readFileSync(file, 'utf8'), n, jlpt);
  }

  const forms = Array.from({ length: FORM_BUCKETS }, () => ({}));
  const kanjiLevels = {};
  const fieldNames = {};
  const entries = Array.from({ length: ENTRY_BUCKETS }, () => ({}));
  for (const w of jmdict.words) {
    const id = Number(w.id);
    const kanji = w.kanji.map((k) => k.text);
    const kana = w.kana.map((k) => k.text);
    const common = w.kanji.some((k) => k.common) || w.kana.some((k) => k.common);
    const pos = [...new Set(w.sense.flatMap((s) => s.partOfSpeech))];
    const senses = w.sense.slice(0, MAX_SENSES).map((s) => [
      s.partOfSpeech.join(','),
      s.gloss.slice(0, MAX_GLOSSES).map((g) => g.text).join('; '),
    ]);
    // Usually written in kana (する, not 為る): the first sense says so.
    const uk = (w.sense[0]?.misc ?? []).includes('uk');
    // Example sentences (Tatoeba): [Japanese, English], from the first meanings first.
    const examples = w.sense
      .flatMap((sn) => sn.examples ?? [])
      .map((ex) => [ex.sentences.find((t) => t.lang === 'jpn')?.text, ex.sentences.find((t) => t.lang === 'eng')?.text])
      .filter(([ja, en]) => ja && en)
      .slice(0, MAX_EXAMPLES);
    // Subject fields (music, sports, food…) of its meanings, for the notebook's topics.
    const fields = [...new Set(w.sense.flatMap((sn) => sn.field ?? []))].slice(0, 3);
    for (const f of fields) fieldNames[f] = jmdict.tags?.[f] ?? f;
    // k: kanji forms, r: readings, p: parts of speech, s: [pos, glosses][], l: JLPT 1–5 (0 none), c: common,
    // u: usually kana, x: example sentences [ja, en][], t: subject fields
    entries[id % ENTRY_BUCKETS][id] = {
      k: kanji, r: kana, p: pos, s: senses, l: jlpt.get(w.id) ?? 0, c: common ? 1 : 0, ...(uk ? { u: 1 } : {}),
      ...(examples.length ? { x: examples } : {}), ...(fields.length ? { t: fields } : {}),
    };
    // Kanji levels: each kanji's easiest JLPT level among the words written with it (main
    // spelling; not words usually written in kana, so 煩い doesn't make 煩 look easy).
    if (jlpt.get(w.id) && kanji[0] && !uk) {
      for (const c of kanji[0]) if (KANJI_RE.test(c)) kanjiLevels[c] = Math.max(kanjiLevels[c] ?? 0, jlpt.get(w.id));
    }
    for (const f of new Set([...kanji, ...kana])) {
      const bucket = forms[f.codePointAt(0) % FORM_BUCKETS];
      (bucket[f] ??= []).push(id);
    }
  }

  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(path.join(OUT, 'forms'), { recursive: true });
  mkdirSync(path.join(OUT, 'entries'), { recursive: true });
  mkdirSync(path.join(OUT, 'kanji'), { recursive: true });
  const write = (file, data) => writeFileSync(file, gzipSync(JSON.stringify(data), { level: 9 }));
  forms.forEach((b, i) => write(path.join(OUT, 'forms', `${i}.json.gz`), b));
  entries.forEach((b, i) => write(path.join(OUT, 'entries', `${i}.json.gz`), b));
  write(path.join(OUT, 'kanji', '0.json.gz'), kanjiLevels);
  mkdirSync(path.join(OUT, 'fields'), { recursive: true });
  write(path.join(OUT, 'fields', '0.json.gz'), fieldNames);
  const freq = await buildFrequencies();
  const freqBuckets = Array.from({ length: FORM_BUCKETS }, () => ({}));
  for (const [form, z] of freq) freqBuckets[form.codePointAt(0) % FORM_BUCKETS][form] = z;
  mkdirSync(path.join(OUT, 'freq'), { recursive: true });
  freqBuckets.forEach((b, i) => write(path.join(OUT, 'freq', `${i}.json.gz`), b));
  console.log(`dict: ${freq.size} word frequencies`);
  writeFileSync(
    metaFile,
    JSON.stringify({
      ...meta,
      words: jmdict.words.length,
      jlptWords: jlpt.size,
      credits: [
        'JMdict, © Electronic Dictionary Research and Development Group, CC BY-SA 4.0 (edrdg.org), via jmdict-simplified',
        'Word frequencies: wordfreq (Robyn Speer et al.), data CC BY-SA 4.0',
        'Example sentences: Tatoeba (tatoeba.org), Tanaka Corpus, CC BY 2.0 FR, via jmdict-simplified',
        'JLPT levels: Jonathan Waller (tanos.co.uk), via stephenmk/yomitan-jlpt-vocab, CC BY-SA 4.0',
      ],
    }),
  );
  rmSync(unpacked, { recursive: true, force: true });
  console.log(`dict: ${jmdict.words.length} words, ${jlpt.size} with a JLPT level → ${path.relative(ROOT, OUT)}`);
}

await main();
