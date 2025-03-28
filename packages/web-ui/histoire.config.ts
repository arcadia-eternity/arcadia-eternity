import { defineConfig } from 'histoire'
import { HstVue } from '@histoire/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [HstVue()],
  setupFile: '/src/histoire-setup.ts',
})
