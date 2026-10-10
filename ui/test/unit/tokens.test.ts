import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const TOKENS = readFileSync(
	join(
		dirname(fileURLToPath(import.meta.url)),
		"../../src/shared/styles/tokens.css",
	),
	"utf8",
);

type Oklch = [l: number, c: number, h: number];
type Palette = Record<string, Oklch>;

const paletteOf = (selector: string): Palette => {
	const block = TOKENS.match(
		new RegExp(
			`^${selector.replace(/[[\]]/g, "\\$&")} \\{\\n([\\s\\S]*?)\\n\\}`,
			"m",
		),
	)?.[1];
	assert.ok(block, `${selector} block in tokens.css`);
	return Object.fromEntries(
		[
			...block.matchAll(/--([\w-]+):\s*oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)/g),
		].map(([, name, l, c, h]) => [name, [Number(l), Number(c), Number(h)]]),
	);
};

const dark = paletteOf(":root");
const light = { ...dark, ...paletteOf(':root[data-theme="light"]') };

// Björn Ottosson's oklab matrices, then a clip to the sRGB cube. A browser gamut-maps an
// out-of-range oklch() by reducing chroma instead, which lands within 0.05 of the same ratio.
const linearSrgb = ([l, c, h]: Oklch) => {
	const a = c * Math.cos((h * Math.PI) / 180);
	const b = c * Math.sin((h * Math.PI) / 180);
	const L = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
	const M = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
	const S = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
	return [
		4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S,
		-1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S,
		-0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S,
	].map((v) => Math.min(1, Math.max(0, v)));
};

const luminance = (colour: Oklch) => {
	const [r, g, b] = linearSrgb(colour);
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const contrast = (fg: Oklch, bg: Oklch) => {
	const [lighter, darker] = [luminance(fg), luminance(bg)].sort(
		(x, y) => y - x,
	);
	return (lighter + 0.05) / (darker + 0.05);
};

const holds = (
	theme: string,
	palette: Palette,
	fg: string,
	bg: string,
	threshold: number,
) =>
	test(`${theme} --${fg} on --${bg} reads at least ${threshold}:1`, () => {
		const ratio = contrast(palette[fg], palette[bg]);
		assert.ok(
			ratio >= threshold,
			`--${fg} on --${bg} reads ${ratio.toFixed(2)}:1 in the ${theme} theme`,
		);
	});

const READABLE_TEXT = 4.5;
const READABLE_GRAPHIC = 3;
const SURFACES = ["bg", "surface", "surface-raised", "surface-sunken"];

holds("dark", dark, "faint", "surface-raised", READABLE_TEXT);
holds("light", light, "faint", "surface-raised", READABLE_TEXT);

for (const surface of SURFACES)
	holds("light", light, "caution", surface, READABLE_TEXT);

// The light star stays gold, under 3:1, so --star is not held here: its outline carries the
// legibility, and rating.spec.ts holds that the outline is darker than the fill.
for (const surface of SURFACES)
	holds("light", light, "star-outline", surface, READABLE_GRAPHIC);

for (const fg of ["text", "muted", "accent-text", "danger", "positive"])
	holds("light", light, fg, "surface-raised", READABLE_TEXT);

test("light --surface-raised is a near-white rather than #fff", () => {
	assert.ok(light["surface-raised"][0] < 1);
});
