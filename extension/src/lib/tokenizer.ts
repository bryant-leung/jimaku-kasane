/// <reference path="./kuromoji.d.ts" />
// kuromoji's dictionary loader, fed by a function instead of XHR (absent in service workers).
import DictionaryLoader from 'kuromoji/src/loader/DictionaryLoader.js';
import Tokenizer from 'kuromoji/src/Tokenizer.js';
import type { MorphToken } from './words';

export interface Morph {
  tokenize(text: string): MorphToken[];
}

/** `read(file)` returns the gunzipped bytes of e.g. `base.dat.gz`. */
export function loadTokenizer(read: (file: string) => Promise<ArrayBuffer>): Promise<Morph> {
  return new Promise((resolve, reject) => {
    const loader = new DictionaryLoader('');
    loader.loadArrayBuffer = (file: string, done: (err: unknown, buf: ArrayBuffer | null) => void) => {
      read(file.replace(/^.*\//, '')).then((b) => done(null, b), (e: unknown) => done(e, null));
    };
    loader.load((err: unknown, dic: unknown) => (err ? reject(err) : resolve(new Tokenizer(dic) as Morph)));
  });
}
