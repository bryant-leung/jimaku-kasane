import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { defineConfig } from 'wxt';

/** ONNX Runtime's WebAssembly files, served from the extension (no remote code). */
const ORT_FILES = /^ort-wasm-simd-threaded\.(mjs|wasm)$/;

export default defineConfig({
  srcDir: 'src',
  outDir: 'dist',
  manifest: {
    name: 'JimakuKasane 字幕重ね',
    description: 'Japanese subtitles layered under the English ones on streaming anime, with a dictionary and study tools.',
    // tabCapture + offscreen: one-click audio auto-sync (Chrome only; Safari has neither).
    permissions: ['storage', 'tabCapture', 'offscreen'],
    // Allow compiling the bundled ONNX Runtime WebAssembly on extension pages.
    content_security_policy: { extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';" },
    host_permissions: ['https://jimaku.cc/*', 'https://graphql.anilist.co/*', 'http://127.0.0.1/*'],
  },
  // kuromoji's loader imports Node's path for one join; the extension needs only that.
  vite: () => ({ resolve: { alias: [{ find: /^path$/, replacement: path.resolve(import.meta.dirname, 'src/lib/path-shim.ts') }] } }),
  hooks: {
    'build:publicAssets': (_wxt, assets) => {
      const dir = path.dirname(createRequire(import.meta.url).resolve('onnxruntime-web/wasm'));
      for (const file of fs.readdirSync(dir).filter((f) => ORT_FILES.test(f))) {
        assets.push({ absoluteSrc: path.join(dir, file), relativeDest: `ort/${file}` });
      }
      // kuromoji's IPADIC dictionary (~18 MB gzipped), loaded by the word splitter.
      const dict = path.join(path.dirname(createRequire(import.meta.url).resolve('kuromoji/package.json')), 'dict');
      for (const file of fs.readdirSync(dict).filter((f) => f.endsWith('.dat.gz'))) {
        assets.push({ absoluteSrc: path.join(dict, file), relativeDest: `kuromoji/${file}` });
      }
    },
  },
});
