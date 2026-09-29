import type { FillPlaylistRequest } from "./playlists";

export type Run = [start: number, count: number];

// A playlist copy and a playlist row removal both take `runs` and read them in ascending order
// whatever order they arrive in, so a caller holding an arbitrary or click-ordered set collapses it
// here rather than sending an order the route would silently ignore.
export function runsOf(positions: ArrayLike<number>): Run[] {
	const sorted = Array.from(new Set(Array.from(positions))).sort(
		(a, b) => a - b,
	);
	const runs: Run[] = [];
	for (const value of sorted) {
		const last = runs[runs.length - 1];
		if (last && value === last[0] + last[1]) last[1] += 1;
		else runs.push([value, 1]);
	}
	return runs;
}

type AscendingScan = { ascending: true; runs: Run[] } | { ascending: false };

const strictlyAscendingRuns = (rows: number[]): AscendingScan => {
	const runs: Run[] = [[rows[0], 1]];
	for (let index = 1; index < rows.length; index += 1) {
		const value = rows[index];
		if (value <= rows[index - 1]) return { ascending: false };

		const run = runs[runs.length - 1];
		if (value === run[0] + run[1]) run[1] += 1;
		else runs.push([value, 1]);
	}
	return { ascending: true, runs };
};

const BASE64_CHARS =
	"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

const base64Of = (bytes: Uint8Array): string => {
	let text = "";
	for (let at = 0; at < bytes.length; at += 3) {
		const b0 = bytes[at];
		const b1 = bytes[at + 1];
		const b2 = bytes[at + 2];
		text += BASE64_CHARS[b0 >> 2];
		text += BASE64_CHARS[((b0 & 0x03) << 4) | (b1 === undefined ? 0 : b1 >> 4)];
		text +=
			b1 === undefined
				? "="
				: BASE64_CHARS[((b1 & 0x0f) << 2) | (b2 === undefined ? 0 : b2 >> 6)];
		text += b2 === undefined ? "=" : BASE64_CHARS[b2 & 0x3f];
	}
	return text;
};

const bitsetOf = (rows: number[], trackCount: number): string => {
	const bytes = new Uint8Array(Math.ceil(trackCount / 8));
	for (const ordinal of rows) bytes[ordinal >> 3] |= 1 << (ordinal & 7);
	return base64Of(bytes);
};

export function encodeFill(
	ordinals: ArrayLike<number>,
	library: { structure: number; trackCount: number },
): FillPlaylistRequest {
	const rows = Array.from(ordinals);
	if (rows.length === 0)
		throw new Error("encodeFill: an empty set cannot fill a playlist");

	const scan = strictlyAscendingRuns(rows);
	if (!scan.ascending) return { structure: library.structure, ordinals: rows };

	const bitsetByteBudget = 4 * Math.ceil(Math.ceil(library.trackCount / 8) / 3);
	const runsCharCount = JSON.stringify(scan.runs).length;

	return runsCharCount <= bitsetByteBudget
		? { structure: library.structure, runs: scan.runs }
		: {
				structure: library.structure,
				bitset: bitsetOf(rows, library.trackCount),
			};
}
