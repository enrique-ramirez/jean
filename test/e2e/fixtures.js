import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { test as base, expect } from '@playwright/test'

import { createServer } from '../fake-beefweb/server.js'
import { createState } from '../fake-beefweb/state.js'

const DIST = join(dirname(fileURLToPath(import.meta.url)), '../../dist')

export const test = base.extend({
  // One fake player per worker, on a port the OS picks. Workers never share a
  // player, so the suite stays parallel without tests seeing each other's
  // playlists.
  fakeServer: [
    async ({}, use) => {
      const server = createServer({ serveDir: DIST })
      await new Promise((resolve) => server.listen(0, resolve))
      await use(server)
      await new Promise((resolve) => server.close(resolve))
    },
    { scope: 'worker' },
  ],

  // A fresh player per test. The previous test's page is closed by now, so no
  // stream is left subscribed to the state being discarded.
  player: async ({ fakeServer }, use) => {
    await use(fakeServer.reset(createState()))
  },

  baseURL: async ({ fakeServer }, use) => {
    await use(`http://localhost:${fakeServer.address().port}`)
  },

  // Settings live in localStorage until they move to /api/clientconfig, and
  // several of them change what is on screen -- the play-count shading
  // introduces itself on first sight, and would otherwise be covering the
  // toolbar in every test that never asked about it. Seeded per test so a test
  // about first-run behaviour can ask for the unseeded version.
  settings: [{ 'jean.heatIntroSeen': true }, { option: true }],

  // The app animates deliberately and without stopping: the play/pause toggle
  // layers scale and rotate on coprime durations for as long as something is
  // playing. Neither moves it, but both change its bounding box every frame,
  // and Playwright waits for a box that holds still across two frames before
  // it will click. Against a permanently moving target that wait can only time
  // out -- so the suite asks for the preference the app already honours in
  // tokens.css rather than forcing clicks past the checks that catch genuinely
  // unclickable elements.
  //
  // The cost is that these tests say nothing about the motion itself. A spec
  // that wants to assert on it opts out with test.use({ motion: 'allow' }).
  motion: ['reduce', { option: true }],

  page: async ({ page, settings, player, motion }, use) => {
    void player
    if (motion === 'reduce') await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.addInitScript((values) => {
      for (const [key, value] of Object.entries(values)) {
        window.localStorage.setItem(key, JSON.stringify(value))
      }
    }, settings)
    await use(page)
  },
})

export { expect }

// The row the virtualiser has mounted for a given position in the view. Rows
// carry data-row, which is their index in the view rather than in the playlist
// -- the two differ the moment anything is filtered.
export const trackRow = (page, index) => page.locator(`[role="row"][data-row="${index}"]`)

export const rowByTitle = (page, title) =>
  page.locator('[role="row"]').filter({ hasText: title }).first()

// What the app sent, so a test can assert on the wire rather than only on the
// screen. Reads the fake's own log, not the browser's.
export const requestsTo = (player, pattern) =>
  player.requests.filter((entry) => entry.path.includes(pattern))
