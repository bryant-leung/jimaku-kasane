// Deep imports of kuromoji (no types published for them).
declare module 'kuromoji/src/loader/DictionaryLoader.js' {
  export default class DictionaryLoader {
    constructor(dicPath: string);
    loadArrayBuffer(file: string, done: (err: unknown, buf: ArrayBuffer | null) => void): void;
    load(done: (err: unknown, dic: unknown) => void): void;
  }
}
declare module 'kuromoji/src/Tokenizer.js' {
  export default class Tokenizer {
    constructor(dic: unknown);
    tokenize(text: string): import('./words').MorphToken[];
  }
}
