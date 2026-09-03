// Not named `lyrics.ts`: on a case-insensitive filesystem `'./Lyrics'` resolves here instead of to `Lyrics.tsx`.
// The `unsynced lyrics` tag holds either plain text or LRC timestamps; this tells the two apart and normalises neither.

export interface LyricLine {
	/** Seconds from the start of the track. */
	at: number;
	/** Empty for a timed gap. Kept rather than dropped: the gap says the next line is not imminent. */
	text: string;
}

export type Lyrics =
	| { kind: "none" }
	| { kind: "plain"; lines: string[] }
	| { kind: "synced"; lines: LyricLine[] };

export const NO_LYRICS: Lyrics = { kind: "none" };

// `[mm:ss]`, `[mm:ss.xx]` and `[mm:ss:xx]` are all in circulation, and the fraction runs to two or three digits.
const TIMESTAMP = /^\[(\d{1,3}):([0-5]?\d)(?:[.:](\d{1,3}))?\]/;

// The `[xx:...]` metadata tags. Only `offset` changes what is drawn, and it is milliseconds to subtract rather than add.
const ID_TAG = /^\[([a-z]{2,8}):(.*)\]$/i;

// A fraction is not always hundredths: `[00:12.5]` is five tenths, `[00:12.500]` five hundred milliseconds. Pad, never divide by a guessed power of ten.
const fractionSeconds = (digits: string | undefined) =>
	digits ? Number(digits.padEnd(3, "0")) / 1000 : 0;

interface SourceLine {
	times: number[];
	text: string;
}

// One tag line can carry several timestamps: `[00:02.68][00:13.88]I never meant to` is a refrain sung twice.
function peel(raw: string): SourceLine {
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

// The floor rejects `[Chorus]`-style headers on an untimed lyric; the share rejects a file where one line was timed by accident.
const SYNCED_MINIMUM = 3;
const SYNCED_SHARE = 0.5;

// Counts alone misclassify credit-only lyrics whose few timestamps all sit in the opening seconds: followable timing needs span, not just count.
const SYNCED_MIN_SPAN = 20;

export function parseLyrics(raw: string | null | undefined): Lyrics {
	if (!raw) return NO_LYRICS;

	const rows = raw.split(/\r\n|\r|\n/);

	let offset = 0;
	const source: SourceLine[] = [];

	for (const row of rows) {
		const trimmed = row.trim();
		const line = peel(trimmed);

		// A metadata tag only counts as one where no timestamp was peeled off: a timed line's text can hold a colon too.
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
				// Clamped at zero: an offset past the first timestamp would sort a line before the track starts, where nothing can make it current.
				times.map((at) => ({ at: Math.max(0, at - offset), text })),
			)
			.sort((a, b) => a.at - b.at);

		const span = lines[lines.length - 1].at - lines[0].at;
		if (span >= SYNCED_MIN_SPAN) return { kind: "synced", lines };
	}

	// Trims rather than filters: interior blanks are stanza breaks and stay.
	const text = source.map((line) => line.text);
	const first = text.findIndex(Boolean);
	const last = text.findLastIndex(Boolean);

	return first < 0
		? NO_LYRICS
		: { kind: "plain", lines: text.slice(first, last + 1) };
}

/** Which line is current at `position`, or -1 before the first. Called on every animation frame, so it binary-searches. */
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
