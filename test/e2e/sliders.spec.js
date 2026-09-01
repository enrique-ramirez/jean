import { expect, requestsTo, test, trackRow } from './fixtures.js'

// The two drag controls. Both go through useDragFraction and both write through
// something that refuses to send one request per pointer event -- which is the
// part worth testing, because a slider that works and floods the player looks
// exactly like a slider that works.

const volume = (page) => page.getByRole('slider', { name: 'Volume' })
const seekBar = (page) => page.getByRole('slider', { name: 'Playback position' })

const openApp = async (page) => {
  await page.goto('/#/p7')
  await expect(page.getByRole('heading', { level: 1, name: 'Library' })).toBeVisible()
  await expect(trackRow(page, 0)).toBeAttached()
}

// On a phone the volume slider is a column inside a popover rather than a row
// in the status bar, so it has to be opened before it exists.
const showVolume = async (page) => {
  if (await volume(page).count()) return
  await page.getByRole('button', { name: 'Volume' }).click()
  await expect(volume(page)).toBeVisible()
}

// Every value the app has sent for the player's volume, in order.
const volumesSent = (player) =>
  requestsTo(player, '/api/player')
    .map((entry) => entry.body?.volume)
    .filter((value) => value !== undefined)

// A drag across a fraction of the track, in `steps` moves, ending where it
// says. Driven with the real mouse rather than dispatched events, because
// pointer capture and the element's own rect are what is under test.
const dragTo = async (page, slider, fraction, steps = 20) => {
  const box = await slider.boundingBox()
  const vertical = box.height > box.width
  const start = vertical
    ? { x: box.x + box.width / 2, y: box.y + box.height }
    : { x: box.x, y: box.y + box.height / 2 }
  const end = vertical
    ? { x: box.x + box.width / 2, y: box.y + box.height * (1 - fraction) }
    : { x: box.x + box.width * fraction, y: box.y + box.height / 2 }

  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(end.x, end.y, { steps })
  await page.mouse.up()
}

test.describe('the volume slider', () => {
  test.skip(({ isMobile }) => isMobile, 'dragging a fader is a mouse gesture')

  test.beforeEach(async ({ page }) => {
    await openApp(page)
    await showVolume(page)
  })

  test('half the travel is around -25 dB, not -50', async ({ page, player }) => {
    // Decibels are logarithmic and everything below about -40 is near-silent,
    // so a linear fader would spend three quarters of its travel on values
    // nobody wants. The curve is the feature; a linear one would land at -50
    // here and pass every other assertion in this file.
    await dragTo(page, volume(page), 0.5)

    await expect.poll(() => volumesSent(player).length).toBeGreaterThan(0)
    const landed = volumesSent(player).at(-1)
    expect(landed).toBeGreaterThan(-30)
    expect(landed).toBeLessThan(-20)
  })

  test('three quarters is around -6 dB', async ({ page, player }) => {
    await dragTo(page, volume(page), 0.75)

    await expect.poll(() => volumesSent(player).length).toBeGreaterThan(0)
    const landed = volumesSent(player).at(-1)
    expect(landed).toBeGreaterThan(-10)
    expect(landed).toBeLessThan(-3)
  })

  test('the ends are the ends', async ({ page, player }) => {
    await dragTo(page, volume(page), 1)
    await expect.poll(() => volumesSent(player).at(-1)).toBe(0)

    await dragTo(page, volume(page), 0)
    await expect.poll(() => volumesSent(player).at(-1)).toBe(-100)
  })

  test('a drag sends far fewer requests than it has moves, and the last one wins', async ({
    page,
    player,
  }) => {
    // The fake answers in microseconds, so every pointer move would find no
    // request in flight and send its own -- which is what a control with no
    // coalescing at all does. A hundred milliseconds is an unremarkable round
    // trip to a player on the same network, and it is what makes the queue
    // observable.
    await page.request.post('/__control/latency', { data: { ms: 100 } })

    const MOVES = 40
    await dragTo(page, volume(page), 0.6, MOVES)

    await expect.poll(() => volumesSent(player).length).toBeGreaterThan(0)
    // Let the tail of the queue land before counting.
    await page.waitForTimeout(400)
    const sent = volumesSent(player)

    // One request per pointer event floods the player, and the responses can
    // land out of order -- so the last value to arrive wins rather than the
    // last one sent. One in flight at a time, newest queued behind it.
    expect(sent.length).toBeLessThan(MOVES / 2)

    // And it converges: whatever was queued during the last flight is still
    // sent afterwards, so the player ends on the value the drag finished on.
    await expect.poll(() => player.player.volume.value).toBe(sent.at(-1))
    expect(sent.at(-1)).toBeGreaterThan(-20)
    expect(sent.at(-1)).toBeLessThan(-5)
  })

  test('it cannot be selected, so a press cannot turn into a native drag', async ({ page }) => {
    // Without this the browser starts a text selection running out across
    // whatever sits beside the control, and dragging a selection paints a
    // translucent snapshot of it that follows the pointer instead of the thumb.
    // It reads as the slider coming loose, and as intermittent, because it
    // depends on where the press landed and what was already selected.
    const style = await volume(page).evaluate((element) => {
      const computed = getComputedStyle(element)
      return { userSelect: computed.userSelect, webkitUserSelect: computed.webkitUserSelect }
    })
    expect(style.userSelect === 'none' || style.webkitUserSelect === 'none').toBe(true)
  })

  test('the reported value is a percentage of the fader, not of the decibels', async ({ page }) => {
    // -100..0 dB is the player's range; a slider that reported it raw would say
    // 77% for a volume most of the way down.
    await dragTo(page, volume(page), 0.5)

    const reported = async () => Number(await volume(page).getAttribute('aria-valuenow'))
    await expect.poll(reported).toBeGreaterThan(45)
    await expect.poll(reported).toBeLessThan(55)
  })
})

test.describe('the seek bar', () => {
  test.skip(({ isMobile }) => isMobile, 'scrubbing is a mouse gesture')

  test('it is not seekable until something is playing', async ({ page }) => {
    await openApp(page)
    await expect(seekBar(page)).toHaveAttribute('data-seekable', 'false')
  })

  test('scrubbing commits once, on release', async ({ page, player }) => {
    await openApp(page)
    await trackRow(page, 0).dblclick()
    await expect(seekBar(page)).toHaveAttribute('data-seekable', 'true')

    const positions = () =>
      requestsTo(player, '/api/player')
        .map((entry) => entry.body?.position)
        .filter((value) => value !== undefined)

    await dragTo(page, seekBar(page), 0.5, 30)

    // Not one per move: scrubbing a track would otherwise fire a request per
    // pointer event and the player would stutter chasing them. Los Calientes is
    // 4:37, so halfway is a bit under two and a half minutes.
    await expect.poll(() => positions()).toHaveLength(1)
    const landed = positions()[0]
    expect(landed).toBeGreaterThan(125)
    expect(landed).toBeLessThan(155)
  })

  test('it cannot be selected either', async ({ page }) => {
    await openApp(page)
    const style = await seekBar(page).evaluate((element) => {
      const computed = getComputedStyle(element)
      return { userSelect: computed.userSelect, webkitUserSelect: computed.webkitUserSelect }
    })
    expect(style.userSelect === 'none' || style.webkitUserSelect === 'none').toBe(true)
  })
})

// A finger, not a mouse. The rest of this file drives the faders with the
// pointer and skips on mobile, which quietly encoded the assumption that
// dragging one is a mouse gesture -- and on a phone the volume column is a
// thing people drag with a thumb all day.
//
// Driven through CDP rather than dispatched as DOM events, because what is
// under test is the browser's own decision about who the gesture belongs to.
// Without `touch-action: none` on the track it decides the finger is panning
// the page, sends `pointercancel`, and stops delivering moves -- so the thumb
// stops wherever it had got to and the value lands short. A dispatched
// `pointermove` would sail past that and pass either way.
test.describe('dragging the fader with a finger', () => {
  test.skip(({ isMobile }) => !isMobile, 'this is the touch gesture')

  const swipe = async (page, box, from, to) => {
    const cdp = await page.context().newCDPSession(page)
    const at = (fraction) => ({
      x: box.x + box.width / 2,
      // The column runs bottom-up: the top of the track is the maximum.
      y: box.y + box.height * (1 - fraction),
    })

    const send = (type, point) =>
      cdp.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: type === 'touchEnd' ? [] : [{ x: point.x, y: point.y }],
      })

    await send('touchStart', at(from))
    for (let step = 1; step <= 12; step += 1) {
      await send('touchMove', at(from + ((to - from) * step) / 12))
    }
    await send('touchEnd', at(to))
    await cdp.detach()
  }

  test('the target is big enough to aim at', async ({ page }) => {
    await openApp(page)
    await showVolume(page)

    // A thumb is about 44px of contact, and the column was 26px wide. What
    // makes the miss expensive rather than merely annoying is where it lands:
    // just off the slider is the popover, which does not claim the gesture, so
    // the browser reads the same downward drag as a page pan and takes it.
    const box = await volume(page).boundingBox()
    expect(box.width, `the fader is ${Math.round(box.width)}px of thumb`).toBeGreaterThanOrEqual(44)
  })

  test('the value follows the finger the whole way', async ({ page, player }) => {
    await openApp(page)
    await showVolume(page)

    const box = await volume(page).boundingBox()
    await swipe(page, box, 0.9, 0.25)

    // Landed near where the finger let go, not stranded partway. The gesture
    // crosses most of the track, so a cancelled pointer stream shows up as a
    // value far from the target rather than as a rounding difference.
    await expect.poll(() => volume(page).getAttribute('aria-valuenow'), {
      message: 'the fader did not follow the finger to the end of the swipe',
    }).toBeTruthy()

    const landed = Number(await volume(page).getAttribute('aria-valuenow'))
    expect(Math.abs(landed - 25), `fader landed at ${landed}%, aimed at 25%`).toBeLessThan(8)

    // And it reached the player. How the writes are coalesced is the mouse
    // drag's test above -- the same `useCoalescedWrite` is under both, and
    // proving it twice would only mean setting the latency up twice.
    await expect.poll(() => volumesSent(player).length).toBeGreaterThan(0)
  })
})
