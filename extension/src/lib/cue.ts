/** A single subtitle line, times in seconds. */
export interface Cue {
  start: number;
  end: number;
  text: string;
}

/** Cues showing at time `t` (seconds), in start order. Expects `cues` sorted by start. */
export function activeCues(cues: readonly Cue[], t: number): Cue[] {
  const out: Cue[] = [];
  for (const c of cues) {
    if (c.start > t) break;
    if (t < c.end) out.push(c);
  }
  return out;
}
