import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  outDir: 'dist',
  manifest: {
    name: 'JP Sub Overlay',
    description: 'Overlay Japanese subtitles on streaming video for learners.',
    // tabCapture + offscreen: one-click audio auto-sync (Chrome only; Safari has neither).
    permissions: ['storage', 'tabCapture', 'offscreen'],
    host_permissions: ['https://jimaku.cc/*', 'https://graphql.anilist.co/*', 'http://127.0.0.1/*'],
  },
});
