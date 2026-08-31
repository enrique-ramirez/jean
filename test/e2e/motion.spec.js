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
  await page.goto('/')
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
