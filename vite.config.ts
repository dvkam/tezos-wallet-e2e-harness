import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    rolldownOptions: { input: ['index.html', 'sandbox.html', 'shadownet.html'] }
  }
})
