import { defineConfig } from 'histoire'
import { HstVue } from '@histoire/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [HstVue()],
  vite: {
    plugins: [tailwindcss()],
    server: {
      proxy: {
        '/api': {
          target: 'http://localhost:8102',
          changeOrigin: true,
          ws: true,
          secure: false,
        },
      },
    },
  },
  viteNodeInlineDeps: [/i18next/, /helpers/, /ocket.io-client/, /@socket.io/],
  setupFile: '/src/histoire-setup.ts',
})
