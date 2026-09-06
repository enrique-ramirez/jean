import { squash } from "@/shared/lib/text";

// A genre has no artwork of its own and never will: the tag is a word, and there is nothing on disk
// to draw for it. So a tile with no sleeves to show draws a figure derived from the name instead --
// the same figure every time, on every device, for as long as the tag is spelled the same way.
// Seeded from `squash`, so `Heavy Metal`, `heavy-metal` and `heavymetal` are one identity.

// Eight of Jean's own hues rather than the whole wheel. A hue per genre off a free-running hash puts
// 142 unrelated colours on one screen, which reads as a fault rather than as variety.
export const TINTS = 8;

export const FIGURES = ["rings", "spokes", "arcs", "waves", "bars"] as const;

export type Figure = (typeof FIGURES)[number];

export interface Mark {
	/** Which of the eight tints, as an index the stylesheet turns into a colour. */
	tint: number;
	figure: Figure;
	/** Deterministic 0..1 draws for whatever the figure varies. */
	draws: number[];
}

// FNV-1a. Cheap, and it avalanches well enough that `Rock` and `Rock En Español` land nowhere near
// each other -- which a sum-of-characters hash does not, and which is the whole point here.
function hash(text: string): number {
	let value = 0x811c9dc5;
	for (let index = 0; index < text.length; index += 1) {
		value ^= text.charCodeAt(index);
		value = Math.imul(value, 0x01000193) >>> 0;
	}
	return value;
}

// mulberry32, so the draws after the first are as unrelated to each other as the seed is to the name.
function draws(seed: number, count: number): number[] {
	let state = seed;
	return Array.from({ length: count }, () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let value = Math.imul(state ^ (state >>> 15), 1 | state);
		value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
		return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
	});
}

/** The figure and tint for a name. Pure, and stable across sessions and devices. */
export function markOf(name: string): Mark {
	const seed = hash(squash(name));
	return {
		tint: seed % TINTS,
		// Off a different slice of the hash than the tint, or figure and colour move together and the
		// grid looks like five colours rather than forty combinations.
		figure: FIGURES[(seed >>> 8) % FIGURES.length],
		draws: draws(seed, 8),
	};
}

const VIEWBOX = 100;

/**
 * The figure as SVG geometry, in a 100x100 box. Stroked in one colour by the caller; no fills, so it
 * sits under a name without competing with it.
 *
 * Deliberately few, heavy strokes. Drawn thin there are enough of them to read as noise, and the tile
 * then competes with the one thing on it that carries meaning -- the sleeve. A pattern is something
 * you stop seeing; a texture of forty hairlines is something you keep having to.
 */
export function pathsOf({ figure, draws: random }: Mark): string[] {
	const at = (index: number) => random[index % random.length];

	switch (figure) {
		case "rings": {
			const count = 3 + Math.floor(at(0) * 2);
			const centre = 30 + at(1) * 40;
			return Array.from({ length: count }, (_, ring) => {
				const radius = ((ring + 1) / (count + 0.5)) * 52;
				return `M ${centre - radius} 50 a ${radius} ${radius} 0 1 0 ${radius * 2} 0 a ${radius} ${radius} 0 1 0 ${-radius * 2} 0`;
			});
		}

		case "spokes": {
			const count = 6 + Math.floor(at(0) * 6);
			const turn = at(1) * Math.PI;
			return Array.from({ length: count }, (_, spoke) => {
				const angle = turn + (spoke / count) * Math.PI * 2;
				const inner = 8 + at(spoke) * 14;
				const outer = 46 + at(spoke + 3) * 22;
				return `M ${50 + Math.cos(angle) * inner} ${50 + Math.sin(angle) * inner} L ${50 + Math.cos(angle) * outer} ${50 + Math.sin(angle) * outer}`;
			});
		}

		case "arcs": {
			const count = 3 + Math.floor(at(0) * 2);
			// One of the four corners, so a wall of these does not all radiate from the same place.
			const corner = Math.floor(at(1) * 4);
			const x = corner === 0 || corner === 3 ? 0 : VIEWBOX;
			const y = corner < 2 ? 0 : VIEWBOX;
			const sweep = corner === 1 || corner === 3 ? 1 : 0;
			return Array.from({ length: count }, (_, arc) => {
				const radius = ((arc + 1) / count) * 96;
				return `M ${x} ${y + (y === 0 ? radius : -radius)} A ${radius} ${radius} 0 0 ${sweep} ${x + (x === 0 ? radius : -radius)} ${y}`;
			});
		}

		case "waves": {
			const count = 2 + Math.floor(at(0) * 2);
			const amplitude = 6 + at(1) * 12;
			return Array.from({ length: count }, (_, wave) => {
				const y = ((wave + 1) / (count + 1)) * VIEWBOX;
				const lift = amplitude * (at(wave) > 0.5 ? 1 : -1);
				return `M -5 ${y} C 20 ${y - lift} 35 ${y + lift} 55 ${y} S 85 ${y - lift} 105 ${y}`;
			});
		}

		case "bars": {
			const count = 4 + Math.floor(at(0) * 3);
			return Array.from({ length: count }, (_, bar) => {
				const x = ((bar + 0.5) / count) * VIEWBOX;
				const height = 18 + at(bar) * 62;
				return `M ${x} ${50 - height / 2} L ${x} ${50 + height / 2}`;
			});
		}
	}
}
