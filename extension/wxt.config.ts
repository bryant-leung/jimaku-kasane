import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  outDir: 'dist',
  manifest: {
    name: 'JP Sub Overlay',
    description: 'Overlay Japanese subtitles on streaming video for learners.',
    permissions: ['storage'],
    host_permissions: ['https://jimaku.cc/*', 'https://graphql.anilist.co/*', 'http://127.0.0.1/*'],
  },
});
