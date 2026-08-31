// Runs the fake on its own, so the app can be developed with no foobar2000 in
// reach:
//
//   node test/fake-api/main.js --port 8880
//   BEEFWEB_URL=http://localhost:8880 pnpm dev
//
// Serving a build directly is the other mode, and is what beefweb itself does:
//
//   pnpm build && node test/fake-api/main.js --serve dist

import { createServer } from './server.js'

const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const at = args.indexOf(name)
  return at >= 0 ? args[at + 1] : fallback
}

const port = Number(flag('--port', 8880))
const serveDir = flag('--serve', null)

createServer({ serveDir }).listen(port, () => {
  console.log(`fake player API on http://localhost:${port}${serveDir ? ` (serving ${serveDir})` : ''}`)
})
