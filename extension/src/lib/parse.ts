import type { Cue } from './cue';

/** A line that could not be parsed. `line` is 1-based. */
export interface ParseIssue {
  line: number;
  message: string;
}

export interface ParseOutput {
  cues: Cue[];
  issues: ParseIssue[];
}

export type FileParseResult =
  | { ok: true; cues: Cue[]; issues: ParseIssue[] }
  | { ok: false; error: string };

const SUPPORTED = ['srt', 'ass', 'ssa'] as const;

/** Decodes subtitle bytes: UTF-8 (with or without BOM), UTF-16 with BOM, else Shift-JIS. */
export function decodeSubtitleBytes(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('shift_jis').decode(bytes);
  }
}

/** Removes HTML-style and ASS override tags, trims lines and drops empty ones. */
function cleanText(raw: string): string {
  return raw
    .replace(/<[^>]+>/g, '')
    .replace(/\{\\[^}]*\}/g, '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n');
}

const byStart = (a: Cue, b: Cue) => a.start - b.start || a.end - b.end;

const SRT_TIME = /(?:(\d+):)?(\d{1,2}):(\d{2})[,.](\d{1,3})/;
const SRT_TIMING = new RegExp(`^\\s*${SRT_TIME.source}\\s*-->\\s*${SRT_TIME.source}`);

function srtSeconds(h: string | undefined, m: string, s: string, frac: string): number {
  return Number(h ?? 0) * 3600 + Number(m) * 60 + Number(s) + Number(frac.padEnd(3, '0')) / 1000;
}

export function parseSrt(text: string): ParseOutput {
  const lines = text.replace(/^\uFEFF/, '').split(/\r\n|\r|\n/);
  const cues: Cue[] = [];
  const issues: ParseIssue[] = [];

  let i = 0;
  while (i < lines.length) {
    if (!lines[i]!.trim()) {
      i++;
      continue;
    }
    const blockStart = i;
    while (i < lines.length && lines[i]!.trim()) i++;
    const block = lines.slice(blockStart, i);

    const t = block.findIndex((l) => l.includes('-->'));
    if (t === -1) {
      issues.push({ line: blockStart + 1, message: 'Missing timestamp' });
      continue;
    }
    const m = SRT_TIMING.exec(block[t]!);
    if (!m) {
      issues.push({ line: blockStart + t + 1, message: 'Invalid timestamp' });
      continue;
    }
    const start = srtSeconds(m[1], m[2]!, m[3]!, m[4]!);
    const end = srtSeconds(m[5], m[6]!, m[7]!, m[8]!);
    const body = cleanText(block.slice(t + 1).join('\n'));
    if (body && end > start) cues.push({ start, end, text: body });
  }
  return { cues: cues.sort(byStart), issues };
}

const ASS_TIME = /^(\d+):(\d{2}):(\d{2})\.(\d{1,3})$/;
const ASS_DEFAULT_FORMAT = ['layer', 'start', 'end', 'style', 'name', 'marginl', 'marginr', 'marginv', 'effect', 'text'];

function assSeconds(v: string): number | null {
  const m = ASS_TIME.exec(v.trim());
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 10 ** m[4]!.length;
}

function assText(raw: string): string | null {
  // Drawing mode (\p1 and up) renders vector shapes, not words.
  if (/\{[^}]*\\p[1-9]/.test(raw)) return null;
  const text = raw
    .replace(/\{[^}]*\}/g, '')
    .replace(/\\N/g, '\n')
    .replace(/\\[nh]/g, ' ');
  return cleanText(text) || null;
}

export function parseAss(text: string): ParseOutput {
  const lines = text.replace(/^\uFEFF/, '').split(/\r\n|\r|\n/);
  const cues: Cue[] = [];
  const issues: ParseIssue[] = [];
  let inEvents = false;
  let format = ASS_DEFAULT_FORMAT;

  lines.forEach((rawLine, idx) => {
    const line = rawLine.trim();
    if (/^\[.*\]$/.test(line)) {
      inEvents = line.toLowerCase() === '[events]';
      return;
    }
    if (!inEvents) return;
    if (/^format:/i.test(line)) {
      format = line.slice(line.indexOf(':') + 1).split(',').map((f) => f.trim().toLowerCase());
      return;
    }
    if (!/^dialogue:/i.test(line)) return;

    const rest = line.slice(line.indexOf(':') + 1);
    const parts: string[] = [];
    let pos = 0;
    for (let f = 0; f < format.length - 1; f++) {
      const comma = rest.indexOf(',', pos);
      if (comma === -1) break;
      parts.push(rest.slice(pos, comma));
      pos = comma + 1;
    }
    parts.push(rest.slice(pos));
    const field = (name: string) => parts[format.indexOf(name)];

    const start = assSeconds(field('start') ?? '');
    const end = assSeconds(field('end') ?? '');
    if (start === null || end === null || parts.length !== format.length) {
      issues.push({ line: idx + 1, message: 'Invalid timestamp' });
      return;
    }
    const body = assText(field('text') ?? '');
    if (body && end > start) cues.push({ start, end, text: body });
  });
  return { cues: cues.sort(byStart), issues };
}

/** Parses a subtitle file by extension. Fails on unsupported types or when nothing parses. */
export function parseSubtitleFile(fileName: string, bytes: Uint8Array): FileParseResult {
  const ext = fileName.toLowerCase().split('.').pop() ?? '';
  if (!(SUPPORTED as readonly string[]).includes(ext)) {
    return { ok: false, error: `Unsupported file type: .${ext}. Use .srt or .ass.` };
  }
  const text = decodeSubtitleBytes(bytes);
  const { cues, issues } = ext === 'srt' ? parseSrt(text) : parseAss(text);
  if (cues.length === 0) {
    const first = issues[0];
    const why = first ? ` (line ${first.line}: ${first.message})` : '';
    return { ok: false, error: `No subtitles found in ${fileName}${why}` };
  }
  return { ok: true, cues, issues };
}
