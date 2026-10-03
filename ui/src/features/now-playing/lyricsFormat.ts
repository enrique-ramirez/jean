export interface LyricLine {
	at: number;
	text: string;
}

export type Lyrics =
	| { kind: "none" }
	| { kind: "plain"; lines: string[] }
	| { kind: "synced"; lines: LyricLine[] };

export const NO_LYRICS: Lyrics = { kind: "none" };

const TIMESTAMP = /^\[(\d{1,3}):([0-5]?\d)(?:[.:](\d{1,3}))?\]/;

export const ID_TAG = /^\[([a-z]{2,8}):(.*)\]$/i;

const fractionSeconds = (digits: string | undefined) =>
	digits ? Number(digits.padEnd(3, "0")) / 1000 : 0;

interface SourceLine {
	times: number[];
	text: string;
}

export function peel(raw: string): SourceLine {
	let rest = raw;
	const times: number[] = [];

	for (;;) {
		const match = TIMESTAMP.exec(rest);
		if (!match) break;
		times.push(
			Number(match[1]) * 60 + Number(match[2]) + fractionSeconds(match[3]),
		);
		rest = rest.slice(match[0].length);
	}

	return { times, text: rest.trim() };
}

const SYNCED_MINIMUM = 3;
const SYNCED_SHARE = 0.5;
const SYNCED_MIN_SPAN = 20;

export function parseLyrics(raw: string | null | undefined): Lyrics {
	if (!raw) return NO_LYRICS;

	const rows = raw.split(/\r\n|\r|\n/);

	let offset = 0;
	const source: SourceLine[] = [];

	for (const row of rows) {
		const trimmed = row.trim();
		const line = peel(trimmed);

		if (line.times.length === 0) {
			const tag = ID_TAG.exec(trimmed);
			if (tag) {
				if (tag[1].toLowerCase() === "offset") {
					const ms = Number(tag[2].trim());
					if (Number.isFinite(ms)) offset = ms / 1000;
				}
				continue;
			}
		}

		source.push(line);
	}

	const timed = source.filter((line) => line.times.length > 0);
	const meaningful = source.filter(
		(line) => line.times.length > 0 || line.text,
	);

	if (meaningful.length === 0) return NO_LYRICS;

	if (
		timed.length >= SYNCED_MINIMUM &&
		timed.length >= meaningful.length * SYNCED_SHARE
	) {
		const lines = timed
			.flatMap(({ times, text }) =>
				times.map((at) => ({ at: Math.max(0, at - offset), text })),
			)
			.sort((a, b) => a.at - b.at);

		const span = lines[lines.length - 1].at - lines[0].at;
		if (span >= SYNCED_MIN_SPAN) return { kind: "synced", lines };
	}

	const text = source.map((line) => line.text);
	const first = text.findIndex(Boolean);
	const last = text.findLastIndex(Boolean);

	return first < 0
		? NO_LYRICS
		: { kind: "plain", lines: text.slice(first, last + 1) };
}

export function activeLineAt(lines: LyricLine[], position: number): number {
	let low = 0;
	let high = lines.length - 1;
	let found = -1;

	while (low <= high) {
		const middle = (low + high) >> 1;
		if (lines[middle].at <= position) {
			found = middle;
			low = middle + 1;
		} else {
			high = middle - 1;
		}
	}

	return found;
}
