import { expect, requestsTo, test, trackRow } from './fixtures.js'

// One test per binding in keymap.js, because a binding that stops firing does
// so silently: `useKeymap` registers only the ids a scope both declares and has
// a handler for, so deleting a handler leaves the shortcut in the help sheet,
// documented and dead. Nothing else in the suite would notice.
//
// Not every binding is here. These already had a home, and moving them would
// have cost the context that makes them worth reading:
//
//   /  ArrowUp/Down  Enter  Escape   finder.spec.js   (the finder's own scope)
//   n                                follow.spec.js   (jump to playing)
//   h                                heat.spec.js     (and finder.spec, where
//                                                      it must NOT fire)
//   Mod+Shift+p                      search-playback.spec.js
//   Alt+ArrowDown                    sidebar.spec.js  (against a real reorder)
//
// Mod is spelled ControlOrMeta rather than Meta: @tanstack/react-hotkeys maps
// Mod by platform and so does Playwright, so writing the literal one would pass
// here and fail the moment the suite runs on Linux.

const searchField = (page) => page.getByLabel('Search your library')
const sidebarLink = (page, title) =>
  page.getByRole('navigation', { name: 'Playlists' }).getByRole('button').filter({ hasText: title })

const openLibrary = async (page) => {
  await page.goto('/#/p7')
  await expect(page.getByRole('heading', { level: 1, name: 'Library' })).toBeVisible()
  await expect(trackRow(page, 0)).toBeAttached()
}

const paths = (player, fragment) => requestsTo(player, fragment).map((entry) => entry.path)

// Every one of these is a keyboard gesture. A phone has no keyboard, and the
// suite runs both projects over every spec, so this is stated once here rather
// than in twenty-odd tests.
test.skip(({ isMobile }) => isMobile, 'no keyboard on the phone')

test.describe('playback', () => {
  test.beforeEach(({ page }) => openLibrary(page))

  test('Space plays and pauses', async ({ page, player }) => {
    // Focus is on the body, which is the case that matters: Space on a focused
    // button activates the button instead, and the app must not be relying on
    // something having been clicked first.
    await page.keyboard.press('Space')
    await expect.poll(() => paths(player, '/player/play-pause')).toHaveLength(1)
  })

  test('Mod with the horizontal arrows changes track', async ({ page, player }) => {
    await page.keyboard.press('ControlOrMeta+ArrowRight')
    await expect.poll(() => paths(player, '/player/next')).toHaveLength(1)

    await page.keyboard.press('ControlOrMeta+ArrowLeft')
    await expect.poll(() => paths(player, '/player/previous')).toHaveLength(1)
  })

  test('Mod+. stops', async ({ page, player }) => {
    await page.keyboard.press('ControlOrMeta+.')
    await expect.poll(() => paths(player, '/player/stop')).toHaveLength(1)
  })

  test('the bare horizontal arrows seek instead', async ({ page, player }) => {
    // Only the vertical pair moves the list cursor, which is what leaves these
    // two free -- so the same key means "seek" or "previous track" depending on
    // one modifier, and the two must not be reachable from each other.
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowLeft')

    await expect
      .poll(() => requestsTo(player, '/api/player').filter((entry) => entry.body?.relativePosition))
      .toHaveLength(2)

    const seeks = requestsTo(player, '/api/player')
      .map((entry) => entry.body?.relativePosition)
      .filter((value) => value !== undefined)
    expect(seeks).toEqual([5, -5])
    expect(paths(player, '/player/next')).toHaveLength(0)
    expect(paths(player, '/player/previous')).toHaveLength(0)
  })

  test('= and - move the volume', async ({ page, player }) => {
    // Known and unfixed: these are only reachable on layouts where they are
    // unshifted. On Spanish, French and German keyboards '=' is Shift+0, the
    // matcher compares modifier state strictly, and the fallback to event.code
    // finds Digit0 rather than Equal -- so volume up is simply unreachable
    // there, with no error. The test asserts the layout it can drive.
    await page.keyboard.press('=')
    await expect.poll(() => paths(player, '/player/volume/up')).toHaveLength(1)

    await page.keyboard.press('-')
    await expect.poll(() => paths(player, '/player/volume/down')).toHaveLength(1)
  })

  test('m mutes and unmutes', async ({ page, player }) => {
    await page.keyboard.press('m')
    await expect.poll(() => player.player.volume.isMuted).toBe(true)

    await page.keyboard.press('m')
    await expect.poll(() => player.player.volume.isMuted).toBe(false)
  })
})

test.describe('navigation and appearance', () => {
  test.beforeEach(({ page }) => openLibrary(page))

  test('Mod+K puts the cursor in the library search', async ({ page }) => {
    await expect(searchField(page)).not.toBeFocused()
    await page.keyboard.press('ControlOrMeta+k')

    // Mod+K always searches the whole library; '/' filters whatever list you
    // are looking at. That distinction is the reason both exist.
    await expect(searchField(page)).toBeFocused()
  })

  test('Mod+B hides the sidebar and brings it back', async ({ page }) => {
    await expect(sidebarLink(page, 'Favorites')).toBeVisible()

    await page.keyboard.press('ControlOrMeta+b')
    await expect(sidebarLink(page, 'Favorites')).toBeHidden()

    await page.keyboard.press('ControlOrMeta+b')
    await expect(sidebarLink(page, 'Favorites')).toBeVisible()
  })

  test('? opens the shortcut sheet', async ({ page }) => {
    await page.keyboard.press('Shift+/')
    const sheet = page.getByRole('dialog', { name: 'Keyboard shortcuts' })
    await expect(sheet).toBeVisible()

    // Rendered from the same array the bindings are registered from, so the
    // help cannot drift from what actually fires -- which is only true while it
    // keeps listing every group.
    for (const group of ['Playback', 'Navigation', 'In a playlist', 'While finding']) {
      await expect(sheet.getByRole('heading', { name: group })).toBeVisible()
    }
  })

  test('t switches the theme', async ({ page }) => {
    const theme = () => page.locator('html').getAttribute('data-theme')
    const before = await theme()

    await page.keyboard.press('t')
    await expect.poll(theme).not.toBe(before)

    await page.keyboard.press('t')
    await expect.poll(theme).toBe(before)
  })
})

test.describe('moving the cursor in a playlist', () => {
  test.beforeEach(({ page }) => openLibrary(page))

  // The cursor is an index in state, not DOM focus: the virtualiser unmounts a
  // focused row the moment it scrolls away, and focus would evaporate with it.
  const cursorRow = (page) => page.locator('[role="row"][data-cursor="true"]')
  const cursorAt = async (page, index) =>
    expect(cursorRow(page)).toHaveAttribute('data-row', String(index))

  test('the arrows and their vim spellings do the same thing', async ({ page }) => {
    await cursorAt(page, 0)

    await page.keyboard.press('ArrowDown')
    await cursorAt(page, 1)
    await page.keyboard.press('j')
    await cursorAt(page, 2)

    await page.keyboard.press('ArrowUp')
    await cursorAt(page, 1)
    await page.keyboard.press('k')
    await cursorAt(page, 0)
  })

  test('Home and End reach both ends', async ({ page }) => {
    await page.keyboard.press('End')
    await cursorAt(page, 53)

    await page.keyboard.press('Home')
    await cursorAt(page, 0)
  })

  test('the page keys move further than one row and stop at the ends', async ({ page }) => {
    await page.keyboard.press('PageDown')
    const afterPageDown = Number(await cursorRow(page).getAttribute('data-row'))
    expect(afterPageDown).toBeGreaterThan(1)

    await page.keyboard.press('PageUp')
    await cursorAt(page, 0)

    // Clamped rather than wrapped: paging up from the top is a no-op, not a
    // jump to the bottom of a 30,000-row library.
    await page.keyboard.press('PageUp')
    await cursorAt(page, 0)
  })
})

test.describe('selecting in a playlist', () => {
  test.beforeEach(({ page }) => openLibrary(page))

  const selected = (page) => page.locator('[role="row"][data-selected="true"]')

  test('Shift with the arrows extends the selection', async ({ page }) => {
    await page.keyboard.press('Shift+ArrowDown')
    await page.keyboard.press('Shift+ArrowDown')
    await expect(selected(page)).toHaveCount(3)

    await page.keyboard.press('Shift+ArrowUp')
    await expect(selected(page)).toHaveCount(2)
  })

  test('Mod+A takes everything and Escape gives it back', async ({ page }) => {
    await page.keyboard.press('ControlOrMeta+a')

    // Everything the virtualiser has mounted, which is what "all" can mean on
    // screen -- the selection itself is a set of indices over all 54 rows.
    const mounted = await page.locator('[role="row"]').count()
    expect(mounted).toBeGreaterThan(1)
    await expect(selected(page)).toHaveCount(mounted)

    await page.keyboard.press('Escape')
    await expect(selected(page)).toHaveCount(0)
  })
})

test.describe('view keys', () => {
  test.beforeEach(({ page }) => openLibrary(page))

  test('v switches between the compact and album layouts', async ({ page }) => {
    const layout = (name) => page.getByRole('button', { name, exact: true })
    await expect(layout('List')).toHaveAttribute('aria-pressed', 'true')

    await page.keyboard.press('v')
    await expect(layout('Albums')).toHaveAttribute('aria-pressed', 'true')

    // Rows are grouped now, and the measurements cached by index mean something
    // else entirely -- which is why the layout switch is worth pressing rather
    // than just reading the toggle.
    await expect(page.locator('section').filter({ hasText: 'Jessico' })).toBeVisible()

    await page.keyboard.press('v')
    await expect(layout('List')).toHaveAttribute('aria-pressed', 'true')
  })
})

test.describe('in search results', () => {
  test('Mod+S offers to save the results as a playlist', async ({ page }) => {
    await page.goto('/#/search')
    await searchField(page).fill('babasonicos')
    await expect(page.getByRole('heading', { level: 1, name: 'babasonicos' })).toBeVisible()
    await expect(trackRow(page, 0)).toBeAttached()

    // The field has focus straight after typing, and this binding has to fire
    // from there -- there is nowhere else the hands would be.
    await page.keyboard.press('ControlOrMeta+s')
    await expect(page.getByRole('textbox', { name: 'Playlist name' })).toBeVisible()
  })
})

test.describe('in the sidebar', () => {
  test('Alt+ArrowUp moves a playlist up', async ({ page, player }) => {
    await openLibrary(page)

    // Registered only while a row holds focus, so that ordinary arrow keys with
    // a modifier cannot fire while the cursor is in the track list.
    await sidebarLink(page, 'Favorites').focus()
    await page.keyboard.press('Alt+ArrowUp')

    await expect
      .poll(() => player.playlists.map((entry) => entry.title).slice(0, 3))
      .toEqual(['Default Playlist', 'Favorites', 'Library'])
  })

  // There is deliberately no test here for the other half of that sentence --
  // that Alt+Arrow does nothing while the cursor is in the track list. Three
  // independent things enforce it (the scope is registered only while a row has
  // focus, moveFocused returns early on a negative index, and again on an
  // out-of-range target), so removing any one of them leaves the assertion
  // green and removing all three only produces a crash. It would have been a
  // test that could not fail, which is worse than not having one.
})
