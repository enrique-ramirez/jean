import { expect, test } from './fixtures.js'

// The play/pause toggle is the app's one piece of continuous motion: while
// something plays it layers `scale` and `rotate` on coprime durations, for as
// long as it plays. That is deliberate. What it must also do is stop when the
// operating system says stop.
const toggle = (page) => page.locator('footer').getByRole('button', { name: 'Pause' })

const shape = (page) =>
  page.evaluate(() => {
    const element = document.querySelector('footer button[aria-label="Pause"]')
    const style = getComputedStyle(element)
    const box = element.getBoundingClientRect()
    // The painted box against the laid-out one. offsetWidth ignores transforms
    // and getBoundingClientRect does not, so the two agreeing means nothing is
    // being scaled or rotated -- without this test having to know how big the
    // button is, which differs by breakpoint.
    return {
      scale: style.scale,
      rotate: style.rotate,
      painted: Number(box.width.toFixed(2)),
      laidOut: element.offsetWidth,
    }
  })

// Sampled on consecutive frames rather than on a timer: the animations run at
// ~700ms and ~1.9s, so anything slower than a frame can miss the movement.
const framesOf = (page, count) =>
  page.evaluate(
    (frames) =>
      new Promise((resolve) => {
        const element = document.querySelector('footer button[aria-label="Pause"]')
        const seen = []
        const tick = () => {
          const box = element.getBoundingClientRect()
          seen.push(`${box.width.toFixed(3)}x${box.height.toFixed(3)}`)
          if (seen.length < frames) requestAnimationFrame(tick)
          else resolve(seen)
        }
        requestAnimationFrame(tick)
      }),
    count,
  )

const startPlaying = async (page) => {
  await page.goto('/#/p7')
  await page.getByRole('main').getByRole('button', { name: 'Play', exact: true }).click()
  await toggle(page).waitFor()
  await page.waitForTimeout(400)
}

test('the toggle comes to rest when motion is reduced', async ({ page }) => {
  await startPlaying(page)

  // Duration alone does not stop an infinite animation -- it runs it about a
  // hundred thousand times a frame, and the element settles wherever the last
  // cycle left it. Measured before the iteration count was added: permanently
  // scale 1.05 1.02 and rotate 2.48deg, so the primary transport control sat
  // 5% oversized and visibly tilted for as long as a track played, for exactly
  // the people who asked for less movement.
  const at = await shape(page)
  expect(at.scale).toBe('none')
  expect(at.rotate).toBe('none')
  expect(at.painted).toBeCloseTo(at.laidOut, 1)

  const frames = await framesOf(page, 8)
  expect(new Set(frames).size).toBe(1)
})

test.describe('with motion allowed', () => {
  test.use({ motion: 'allow' })

  test('it really is animating, so the test above means something', async ({ page }) => {
    // Without this the assertion above would pass just as happily against a
    // button that never moved in the first place.
    await startPlaying(page)

    const frames = await framesOf(page, 8)
    expect(new Set(frames).size).toBeGreaterThan(1)

    // And it is genuinely transformed, not merely repainting: a rotated square
    // has a wider bounding box than the square itself.
    const at = await shape(page)
    expect(at.painted).toBeGreaterThan(at.laidOut)
  })
})

// The other piece of continuous motion, and the one with a rule to obey: the
// pill is a button, and a button that will not hold still is a button you
// cannot click. So the arrow moves and the pill does not.
test.describe('the now-playing arrow', () => {
  test.use({ motion: 'allow', settings: { 'jean.heatIntroSeen': true } })

  const pill = (page) => page.getByRole('button', { name: 'Now playing' })

  // Consecutive frames rather than a timer: the nod runs at 2.3s, so a sample
  // slower than a frame can land twice in the same place and prove nothing.
  const frames = (page, count) =>
    page.evaluate(
      (wanted) =>
        new Promise((resolve) => {
          const seen = []
          const step = () => {
            const arrow = document.querySelector('[data-visible="true"] svg')
            const pilled = document.querySelector('[data-visible="true"]')
            seen.push({
              arrow: arrow ? getComputedStyle(arrow).transform : null,
              box: pilled ? pilled.getBoundingClientRect().top.toFixed(2) : null,
            })
            if (seen.length < wanted) requestAnimationFrame(step)
            else resolve(seen)
          }
          requestAnimationFrame(step)
        }),
      count,
    )

  // Played from the player's side rather than by clicking a row, then scrolled
  // back to the top: following playback would otherwise scroll the track we
  // just started straight back into view, and the pill only exists while it is
  // out of it.
  const showPill = async (page, player) => {
    await page.goto('/#/p7')
    await expect(page.getByRole('heading', { level: 1, name: 'Library' })).toBeVisible()
    player.playItem('p7', 40)
    await expect(page.locator('footer')).toContainText('Goodnite, Noises Everywhere')

    // Let the follow finish before scrolling away from it. It is an animated
    // scroll, so racing it means scrolling to the top and being carried back.
    await page.waitForTimeout(1000)
    await page.evaluate(() => document.querySelector('main').scrollTo(0, 0))
    await expect.poll(() => page.evaluate(() => document.querySelector('main').scrollTop)).toBe(0)
    await expect(pill(page)).toBeVisible()
    // And let it finish arriving. The pill slides in over 240ms, so sampling
    // straight away measures its entrance rather than the arrow's nod -- which
    // would make the "the pill does not move" assertion fail on the one bit of
    // movement it is supposed to allow.
    await page.waitForTimeout(400)
  }

  test('the arrow moves and the pill it sits in does not', async ({ page, player }) => {
    await showPill(page, player)
    const seen = await frames(page, 20)

    const moved = new Set(seen.map((frame) => frame.arrow))
    expect(moved.size, 'the arrow never moved').toBeGreaterThan(1)

    // The whole reason this is on the icon rather than on the pill. Playwright
    // will not click a box that is still moving, and neither will a thumb.
    const boxes = new Set(seen.map((frame) => frame.box))
    expect(boxes.size, `the pill moved through ${boxes.size} positions`).toBe(1)
  })

  test('it points the way it is pointing', async ({ page, player }) => {
    await showPill(page, player)

    // Playing track below, list scrolled to the top: the arrow points down.
    await expect(pill(page)).toHaveAttribute('data-direction', 'down')
    const named = await page.evaluate(
      () => getComputedStyle(document.querySelector('[data-visible="true"] svg')).animationName,
    )
    expect(named).toContain('nod-down')
  })

  test('and it stops when the system says stop', async ({ page, player }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await showPill(page, player)
    const seen = await frames(page, 12)
    expect(new Set(seen.map((frame) => frame.arrow)).size).toBe(1)
  })
})
