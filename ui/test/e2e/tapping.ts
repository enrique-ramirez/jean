import type { Locator } from "./fixtures.ts";
import { expect } from "./fixtures.ts";

// Apple's Human Interface Guidelines put a touch target's least side at 44 points. Under a coarse
// pointer every control reaches it, drawn that size or given a hit area around its glyph.
export const TOUCH_TARGET = 44;

const HIT_TEST_STEP = 0.5;

export const tapExtent = (control: Locator) =>
	control.evaluate(
		(element, { reach, step }) => {
			const box = element.getBoundingClientRect();
			const centre = {
				x: box.left + box.width / 2,
				y: box.top + box.height / 2,
			};
			const reaches = (x: number, y: number) => {
				const hit = document.elementFromPoint(x, y);
				return hit !== null && element.contains(hit);
			};
			const span = (at: (offset: number) => boolean) => {
				let out = 0;
				while (out + step <= reach && at(out + step)) out += step;
				return out;
			};
			return {
				width:
					step +
					span((d) => reaches(centre.x - d, centre.y)) +
					span((d) => reaches(centre.x + d, centre.y)),
				height:
					step +
					span((d) => reaches(centre.x, centre.y - d)) +
					span((d) => reaches(centre.x, centre.y + d)),
			};
		},
		{ reach: TOUCH_TARGET, step: HIT_TEST_STEP },
	);

// Chromium hit-tests at device pixels, 1/2.625 of a CSS pixel on the Pixel 7, so an edge can read
// up to half a pixel short of where it is drawn.
const ROUNDING = 0.5;

export const expectTapTarget = async (control: Locator, name: string) => {
	await expect(control, name).toBeVisible();
	const { width, height } = await tapExtent(control);
	expect(width, `${name} reaches ${width} px across`).toBeGreaterThanOrEqual(
		TOUCH_TARGET - ROUNDING,
	);
	expect(height, `${name} reaches ${height} px tall`).toBeGreaterThanOrEqual(
		TOUCH_TARGET - ROUNDING,
	);
};
