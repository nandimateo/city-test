import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { councilPlugin } from './server/council.js'

// GitHub Pages serves the site at https://<user>.github.io/<repo>/.
// In GitHub Actions, GITHUB_REPOSITORY is "<user>/<repo>"; locally it is unset.
const repo = process.env.GITHUB_REPOSITORY?.split('/')[1]
const base = repo && !repo.endsWith('.github.io') ? `/${repo}/` : '/'

export default defineConfig({
  // The council's endpoint runs only in the dev server on this laptop.
  plugins: [react(), councilPlugin()],
  base,
})
