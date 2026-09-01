import { expect, requestsTo, test } from './fixtures.js'

// 'babasonicos' matches the twelve Jessico tracks, library indices 0-11.
// The scratch says which kind of view filled it: 'Most played' is both a
// plausible search and the name of a shelf, and a reload has to tell them apart.
const QUERY = { text: 'babasonicos', matches: 12, title: '#Jean [search: babasonicos]' }
const NARROWER = { text: 'delectrico', matches: 1, title: '#Jean [search: delectrico]' }

const header = (page) => page.locator('main header')
const scratchOf = (player) => player.playlists.find((entry) => entry.title.startsWith('#Jean ['))

const search = async (page, text) => {
  await page.goto('/#/search')
  await page.getByLabel('Search your library').fill(text)
  await expect(page.getByRole('heading', { level: 1, name: text })).toBeVisible()
  await expect(page.locator('[role="row"][data-row="0"]')).toBeAttached()
}

const playedFrom = (player) => {
  const play = requestsTo(player, '/player/play/').at(-1)
  if (!play) return null
  // '' / api / player / play / {plref} / {index}
  const [, , , , plref, index] = play.path.split('/')
  return { plref, index: Number(index) }
}

test.describe('playing from search results', () => {
  test('the results become a real playlist and playback happens inside it', async ({
    page,
    player,
  }) => {
    await search(page, QUERY.text)

    // Nothing exists until someone actually asks to hear something: typing and
    // refining stay entirely client-side.
    expect(scratchOf(player)).toBeUndefined()

    await page.locator('[role="row"][data-row="2"]').dblclick()

    await expect.poll(() => scratchOf(player)?.items.length).toBe(QUERY.matches)
    const scratch = scratchOf(player)
    expect(scratch.title).toBe(QUERY.title)

    // Played from the scratch playlist by position, not from the library by
    // index -- which is the whole point. What comes next is now these results'
    // business rather than the library's.
    await expect.poll(() => playedFrom(player)?.plref).toBe(scratch.id)
    expect(playedFrom(player).index).toBe(2)
  })

  test('it holds exactly the matches, in the order shown', async ({ page, player }) => {
    await search(page, QUERY.text)
    await page.locator('[role="row"][data-row="0"]').dblclick()
    await expect.poll(() => scratchOf(player)?.items.length).toBe(QUERY.matches)

    const library = player.playlists.find((entry) => entry.title === 'Library')
    const titleOf = (track) => track['%title%']

    // Identity by track rather than by index: the copy is by index, so an
    // off-by-one would still produce twelve items and the wrong twelve.
    expect(scratchOf(player).items.map(titleOf)).toEqual(
      library.items.slice(0, QUERY.matches).map(titleOf),
    )
  })

  test('refining the query rebuilds it rather than making another', async ({ page, player }) => {
    await search(page, QUERY.text)
    await page.locator('[role="row"][data-row="0"]').dblclick()
    await expect.poll(() => scratchOf(player)?.items.length).toBe(QUERY.matches)
    const firstId = scratchOf(player).id

    await page.getByLabel('Search your library').fill(NARROWER.text)
    await expect(page.getByRole('heading', { level: 1, name: NARROWER.text })).toBeVisible()
    await page.locator('[role="row"][data-row="0"]').dblclick()

    await expect.poll(() => scratchOf(player)?.items.length).toBe(NARROWER.matches)
    // One playlist, reused. Creating one per search would churn ids and litter
    // the player with a playlist per keystroke anyone happened to play from.
    expect(player.playlists.filter((entry) => entry.title.startsWith('#Jean ['))).toHaveLength(1)
    expect(scratchOf(player).id).toBe(firstId)
    expect(scratchOf(player).title).toBe(NARROWER.title)
  })

  test('playing a second result from the same search does not rebuild it', async ({
    page,
    player,
  }) => {
    await search(page, QUERY.text)
    await page.locator('[role="row"][data-row="0"]').dblclick()
    await expect.poll(() => scratchOf(player)?.items.length).toBe(QUERY.matches)

    const copiesBefore = requestsTo(player, '/items/copy').length
    await page.locator('[role="row"][data-row="5"]').dblclick()

    await expect.poll(() => playedFrom(player)?.index).toBe(5)
    // Already holds this set, so the second play is one request.
    expect(requestsTo(player, '/items/copy')).toHaveLength(copiesBefore)
  })

  test('shuffle shuffles the results and nothing else', async ({ page, player }) => {
    await search(page, QUERY.text)

    await header(page).getByRole('button', { name: 'Shuffle' }).click()

    await expect.poll(() => scratchOf(player)?.items.length).toBe(QUERY.matches)
    await expect.poll(() => playedFrom(player)?.plref).toBe(scratchOf(player).id)
    // The order is on, and it is drawing from a playlist that is exactly these
    // twelve tracks -- so there is nowhere else for it to go.
    await expect.poll(() => player.player.playbackMode).toBe(4)
    expect(playedFrom(player).index).toBeLessThan(QUERY.matches)
  })

  test('Jean does not show its own scratch playlist anywhere', async ({ page, player }) => {
    await search(page, QUERY.text)
    await page.locator('[role="row"][data-row="0"]').dblclick()
    await expect.poll(() => scratchOf(player)?.items.length).toBe(QUERY.matches)

    // It exists on the player and it will show up in foobar -- there is no
    // hidden playlist to be had -- but it is Jean's workspace, not one of the
    // user's playlists, so it appears in none of the places those are offered.
    await page.goto('/#/p5')
    await expect(page.getByRole('heading', { level: 1, name: 'Rock en Español' })).toBeVisible()

    // Opened first on a phone, where the sidebar is a drawer -- asserting
    // against a closed one would pass without having looked at anything. On a
    // desktop it is already there, and the same button would collapse it.
    const sidebar = page.getByRole('navigation')
    if (test.info().project.name === 'mobile') {
      await page.getByRole('button', { name: 'Show playlists' }).click()
    }
    await expect(sidebar.getByText('Rock en Español')).toBeVisible()
    await expect(sidebar.getByText(QUERY.title)).toHaveCount(0)
  })

  test('and does not offer it as somewhere to file tracks', async ({ page, player }) => {
    await search(page, QUERY.text)
    await page.locator('[role="row"][data-row="0"]').dblclick()
    await expect.poll(() => scratchOf(player)?.items.length).toBe(QUERY.matches)

    await page.goto('/#/p5')
    await expect(page.getByRole('heading', { level: 1, name: 'Rock en Español' })).toBeVisible()

    // Filing a track into the scratch playlist would put it somewhere the next
    // search silently empties.
    await page.locator('[role="row"][data-row="0"]').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Add to playlist' }).click()

    await expect(page.getByRole('menuitem', { name: 'Favorites' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: QUERY.title })).toHaveCount(0)
  })

  test('and does not offer it as somewhere to go', async ({ page, player }) => {
    test.skip(test.info().project.name === 'mobile', 'the palette is a keyboard shortcut')

    await search(page, QUERY.text)
    await page.locator('[role="row"][data-row="0"]').dblclick()
    await expect.poll(() => scratchOf(player)?.items.length).toBe(QUERY.matches)

    await page.keyboard.press('Meta+Shift+p')
    // Scoped to the palette: the sidebar names these playlists too.
    const palette = page.getByRole('dialog', { name: 'Go to playlist' })
    await expect(palette.getByRole('option', { name: 'Favorites' })).toBeVisible()
    await expect(palette.getByRole('option', { name: QUERY.title })).toHaveCount(0)
  })

})

test.describe('a search outlives the tab it was typed in', () => {
  const playFirstResult = async (page) => {
    await search(page, QUERY.text)
    await page.locator('[role="row"][data-row="0"]').dblclick()
  }

  test('a reload comes back to the same results', async ({ page, player }) => {
    await playFirstResult(page)
    await expect.poll(() => scratchOf(player)?.items.length).toBe(QUERY.matches)

    await page.reload()

    // The query was only ever in memory; the player is what remembered it,
    // because the playlist it is holding is named after it.
    await expect(page.getByRole('heading', { level: 1, name: QUERY.text })).toBeVisible()
    await expect(page.getByLabel('Search your library')).toHaveValue(QUERY.text)
    await expect(page.locator('[role="row"]').first()).toContainText('Los Calientes')
  })

  test('another device finds it, and can see it is what is playing', async ({ page, player }) => {
    await playFirstResult(page)
    await expect.poll(() => scratchOf(player)?.items.length).toBe(QUERY.matches)

    // A different device: nothing of Jean's own kept, landing on the root
    // rather than on the search route.
    await page.goto('/#/p7')
    await page.evaluate(() => localStorage.clear())
    await page.goto('/#/p7')
    await expect(page.locator('footer')).toContainText('Los Calientes')

    const sidebar = page.getByRole('navigation')
    if (test.info().project.name === 'mobile') {
      await page.getByRole('button', { name: 'Show playlists' }).click()
    }
    await expect(sidebar.getByText(QUERY.text)).toBeVisible()
    // The scratch playlist is hidden, so without this the status bar would name
    // a track with nothing on screen saying where it came from.
    await expect(sidebar.getByLabel('Playing from here')).toBeVisible()

    await sidebar.getByText(QUERY.text).click()

    await expect(page.getByRole('heading', { level: 1, name: QUERY.text })).toBeVisible()
    await expect(page.locator('[role="row"]').first()).toContainText('Los Calientes')
  })

  test('and with no search behind it there is no shelf at all', async ({ page }) => {
    await page.goto('/#/p7')
    await expect(page.getByRole('heading', { level: 1, name: 'Library' })).toBeVisible()

    const sidebar = page.getByRole('navigation')
    if (test.info().project.name === 'mobile') {
      await page.getByRole('button', { name: 'Show playlists' }).click()
    }
    // An entry that means nothing most of the time is a dead shelf.
    await expect(sidebar.getByText('Search', { exact: true })).toHaveCount(0)
  })
})

test.describe('clearing the search', () => {
  test('takes the scratch playlist with it', async ({ page, player }) => {
    await search(page, QUERY.text)
    await page.locator('[role="row"][data-row="0"]').dblclick()
    await expect.poll(() => scratchOf(player)?.items.length).toBe(QUERY.matches)

    // Stop first, so the player is not on it. Nobody asked for a playlist named
    // after a search they closed.
    await page.locator('footer').getByRole('button', { name: 'Pause' }).click()
    await page.goto('/#/p5')
    await expect(page.getByRole('heading', { level: 1, name: 'Rock en Español' })).toBeVisible()

    // Stopped on the player, and then waited for the browser to have heard it.
    // Whether the scratch survives is decided from the app's copy of the player
    // state, so clicking before the push lands reads the old answer.
    // Playing is two requests -- build the playlist, then play from it -- and
    // the poll above only waits for the first. Stopping between them would land
    // before playback had started and the play would undo it.
    await expect(page.locator('footer')).toContainText('Los Calientes')
    player.stop()
    await expect(page.locator('footer')).toContainText('Nothing playing')

    await page.getByRole('button', { name: 'Clear search' }).click()

    await expect.poll(() => scratchOf(player)).toBeUndefined()
  })

  test('but not while the player is still on it', async ({ page, player }) => {
    await search(page, QUERY.text)
    await page.locator('[role="row"][data-row="0"]').dblclick()
    await expect.poll(() => scratchOf(player)?.items.length).toBe(QUERY.matches)

    await page.getByRole('button', { name: 'Clear search' }).click()
    await page.waitForTimeout(400)

    // Measured: deleting the playing playlist does not stop at the end of the
    // track. The player falls back to another playlist and keeps going, which
    // is the wandering out of the results this arrangement exists to stop. So
    // it outlives the search for as long as it is being listened to.
    expect(scratchOf(player)).toBeDefined()
    expect(scratchOf(player).items).toHaveLength(QUERY.matches)
  })
})

test.describe('saving results as a playlist', () => {
  test('saving adopts the playlist the results were already playing from', async ({
    page,
    player,
  }) => {
    await search(page, QUERY.text)
    await page.locator('[role="row"][data-row="0"]').dblclick()
    await expect.poll(() => scratchOf(player)?.items.length).toBe(QUERY.matches)
    const scratchId = scratchOf(player).id
    const playlistsBefore = player.playlists.length
    await expect(page.locator('footer')).toContainText('Los Calientes')

    await page.getByRole('button', { name: 'Save as playlist' }).click()
    await page.getByRole('textbox', { name: 'Playlist name' }).fill('Keepers')
    await page.getByRole('button', { name: 'Create' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Keepers' })).toBeVisible()

    // The same playlist, renamed -- not a second copy of it beside the first.
    // Counted rather than matched on length: two unrelated playlists can hold
    // the same number of tracks, and in this fixture two of them do.
    const keepers = player.playlists.find((entry) => entry.title === 'Keepers')
    expect(keepers.id).toBe(scratchId)
    expect(keepers.items).toHaveLength(QUERY.matches)
    expect(player.playlists).toHaveLength(playlistsBefore)
    expect(scratchOf(player)).toBeUndefined()

    // And playback never moved, because it never had to.
    expect(player.player.activeItem.playlistId).toBe(scratchId)
    await expect(page.locator('footer')).toContainText('Los Calientes')
  })

  // Every other test here plays first, so the scratch already holds exactly
  // these results and saving is a rename. This is the other branch: results
  // that were never played have no playlist behind them, so one is made and
  // filled.
  //
  // It used to copy those refs out of the `Library` autoplaylist by index. A
  // ref is only an index into its own source, and on a player with a media
  // library it addresses the library's path-ordered array instead -- so the
  // saved playlist got whatever sat at those positions in a differently ordered
  // list. Measured against the fallback it was right and against the library it
  // began "Jaws Theme Swimming". No error either way, which is why the title is
  // asserted and not just the count.
  test('saving results that were never played builds the playlist', async ({ page, player }) => {
    await search(page, QUERY.text)
    expect(scratchOf(player)).toBeUndefined()
    const playlistsBefore = player.playlists.length

    await page.getByRole('button', { name: 'Save as playlist' }).click()
    await page.getByRole('textbox', { name: 'Playlist name' }).fill('Unplayed')
    await page.getByRole('button', { name: 'Create' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Unplayed' })).toBeVisible()

    const saved = player.playlists.find((entry) => entry.title === 'Unplayed')
    expect(saved.items).toHaveLength(QUERY.matches)
    expect(player.playlists).toHaveLength(playlistsBefore + 1)

    // Made from the results rather than from whatever happened to be at those
    // indices: the twelve Jessico tracks, in order. Items are the player's own
    // title-formatting rows, so the key is the expression.
    expect(saved.items[0]['%title%']).toBe('Los Calientes')

    // And nothing was played to get here.
    expect(playedFrom(player)).toBeNull()
    expect(scratchOf(player)).toBeUndefined()
  })

  test('and takes the search out of the sidebar with it', async ({ page, player }) => {
    await search(page, QUERY.text)
    await page.locator('[role="row"][data-row="0"]').dblclick()
    await expect.poll(() => scratchOf(player)?.items.length).toBe(QUERY.matches)
    await expect(page.locator('footer')).toContainText('Los Calientes')

    await page.getByRole('button', { name: 'Save as playlist' }).click()
    await page.getByRole('textbox', { name: 'Playlist name' }).fill('Keepers')
    await page.getByRole('button', { name: 'Create' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Keepers' })).toBeVisible()

    const sidebar = page.getByRole('navigation')
    if (test.info().project.name === 'mobile') {
      await page.getByRole('button', { name: 'Show playlists' }).click()
    }
    // The search is over: it has become a playlist, which is right there.
    await expect(sidebar.getByText('Keepers')).toBeVisible()
    await expect(sidebar.getByText(QUERY.text)).toHaveCount(0)
    await expect(page.getByLabel('Search your library')).toHaveValue('')
  })

  test('a later search does not reclaim the playlist that was saved', async ({ page, player }) => {
    await search(page, QUERY.text)
    await page.locator('[role="row"][data-row="0"]').dblclick()
    await expect.poll(() => scratchOf(player)?.items.length).toBe(QUERY.matches)
    await expect(page.locator('footer')).toContainText('Los Calientes')

    await page.getByRole('button', { name: 'Save as playlist' }).click()
    await page.getByRole('textbox', { name: 'Playlist name' }).fill('Keepers')
    await page.getByRole('button', { name: 'Create' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Keepers' })).toBeVisible()
    const keepersId = player.playlists.find((entry) => entry.title === 'Keepers').id

    // Adopting leaves the stored id pointing at a playlist that is now the
    // user's. Resolving the scratch by that id without checking it is still one
    // would hand their saved playlist to the next search, which empties what it
    // finds before refilling it -- so the failure here is not a wrong view, it
    // is their playlist gone.
    await search(page, NARROWER.text)
    await page.locator('[role="row"][data-row="0"]').dblclick()
    await expect.poll(() => scratchOf(player)?.items.length).toBe(NARROWER.matches)

    const keepers = player.playlists.find((entry) => entry.id === keepersId)
    expect(keepers.title).toBe('Keepers')
    expect(keepers.items).toHaveLength(QUERY.matches)
    expect(scratchOf(player).id).not.toBe(keepersId)
  })

  test('saving finishes the search off', async ({ page, player }) => {
    await search(page, QUERY.text)
    await page.locator('[role="row"][data-row="0"]').dblclick()
    await expect.poll(() => scratchOf(player)?.items.length).toBe(QUERY.matches)

    // Playing is two requests -- build the playlist, then play from it -- and
    // the poll above only waits for the first. Stopping between them would land
    // before playback had started and the play would undo it.
    await expect(page.locator('footer')).toContainText('Los Calientes')
    player.stop()
    await expect(page.locator('footer')).toContainText('Nothing playing')

    await page.getByRole('button', { name: 'Save as playlist' }).click()
    await page.getByRole('textbox', { name: 'Playlist name' }).fill('Keepers')
    await page.getByRole('button', { name: 'Create' }).click()

    // The results have somewhere permanent to live now, so the temporary
    // version of them goes.
    await expect(page.getByRole('heading', { level: 1, name: 'Keepers' })).toBeVisible()
    await expect.poll(() => scratchOf(player)).toBeUndefined()
    await expect(page.getByLabel('Search your library')).toHaveValue('')
  })

  test('opening the form does not carry the header off the top', async ({ page }) => {
    await search(page, QUERY.text)
    const titleTop = () =>
      page.evaluate(() => Math.round(document.querySelector('main h1').getBoundingClientRect().top))
    const before = await titleTop()

    await page.getByRole('button', { name: 'Save as playlist' }).click()
    await expect(page.getByRole('textbox', { name: 'Playlist name' })).toBeFocused()

    // The header was a scroll container -- `overflow: hidden` still is one --
    // so focusing a field the popover put past its bottom edge had the browser
    // scroll the header inside itself, taking the title and the mosaic with it
    // while the page never moved.
    expect(await page.evaluate(() => document.querySelector('main header').scrollTop)).toBe(0)
    expect(await titleTop()).toBe(before)

    // And the form is whole: clipping the header instead of letting it scroll
    // would have cut these off rather than moved them.
    const create = page.getByRole('button', { name: 'Create' })
    await expect(create).toBeVisible()
    await expect(create).toBeInViewport()
  })
})

test.describe('a player that will not let Jean make playlists', () => {
  test.use({ playerState: { permissions: { changePlaylists: false, changeOutput: true, changeClientConfig: true } } })

  test('results still play, in place, and say nothing about shuffle', async ({ page, player }) => {
    await search(page, QUERY.text)

    // No scratch playlist is possible, so the old behaviour is the honest
    // fallback: the track plays, and what follows it is the library's business.
    await expect(header(page).getByRole('button', { name: 'Shuffle' })).toHaveCount(0)

    await page.locator('[role="row"][data-row="2"]').dblclick()

    // The `#Jean Library` autoplaylist, looked up rather than hardcoded: it is
    // whichever playlist carries the name, and the name is the identity.
    const libraryId = player.playlists.find((entry) => entry.title === '#Jean Library').id
    await expect.poll(() => playedFrom(player)?.plref).toBe(libraryId)
    expect(playedFrom(player).index).toBe(2)
    expect(scratchOf(player)).toBeUndefined()
  })
})

test.describe('marking the row that is playing', () => {
  // The library source identifies a row by `(path, subsong)`, which playlist
  // items do not have. So it can answer "is this the track that is playing"
  // from wherever the player happens to be -- including a playlist Jean is not
  // looking at. The autoplaylist fallback cannot: index is identity there, and
  // an index only means anything inside its own playlist.
  test('a track playing from another playlist is still marked in the results', async ({
    page,
    player,
  }) => {
    const noLibraryApi = Boolean(process.env.JEAN_NO_LIBRARY_API)

    // Rock en Español holds Los Calientes too, and it is not the library and
    // not the scratch. Playing it there is the case that used to go unmarked.
    await page.goto('/#/p5')
    await expect(page.getByRole('heading', { level: 1, name: 'Rock en Español' })).toBeVisible()
    await page.locator('[role="row"][data-row="0"]').dblclick()
    await expect(page.locator('footer')).toContainText('Los Calientes')
    expect(player.player.activeItem.playlistId).toBe('p5')

    await search(page, QUERY.text)

    // Nothing was played from the results, so no scratch playlist exists and
    // there is no position to read off one.
    expect(scratchOf(player)).toBeUndefined()

    const marked = page.locator('[role="row"][data-active="true"]')
    if (noLibraryApi) {
      // Honest degradation rather than a wrong answer: without paths there is
      // nothing to match on, so the row is left unmarked.
      await expect(marked).toHaveCount(0)
    } else {
      await expect(marked).toHaveCount(1)
      await expect(marked).toContainText('Los Calientes')
    }
  })
})
