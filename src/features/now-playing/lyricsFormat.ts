// Named for the format rather than for the feature, because `Lyrics.tsx` sits
// beside it: on a case-insensitive filesystem TypeScript resolves `'./Lyrics'`
// by probing `Lyrics.ts` first, macOS answers yes to `lyrics.ts`, and the
// component import lands silently on this module instead. Same family as naming
// a store after the component next to it -- see the root CLAUDE.md. The
// compiler caught this one; nothing else would have.
//
// Lyrics come out of an ordinary tag -- `$meta(unsynced lyrics)`, with a space
// -- and the name lies: *measured* over one 30,441-track library, 7,705 tracks
// carry the tag and roughly half of those hold LRC timestamps. So the field is
// two formats under one name and this file is what tells them apart.
//
// Nothing here cleans anything up. A tag holding `www.laenea.com` instead of
// lyrics is drawn as the one line it is, and a NetEase rip that opens with
// `作曲 : ...` keeps its credits: tag hygiene is the library owner's business,
// and a normalisation layer would make Jean disagree with the player about what
// the library contains. See the root CLAUDE.md.

export interface LyricLine {
	// Seconds from the start of the track.
	at: number;
	// Empty for a timed gap -- an intro or an instrumental break. Kept rather
	// than dropped, because the gap is what tells a reader the next line is not
	// imminent.
	text: string;
}

export type Lyrics =
	| { kind: "none" }
	| { kind: "plain"; lines: string[] }
	| { kind: "synced"; lines: LyricLine[] };

export const NO_LYRICS: Lyrics = { kind: "none" };

// `[mm:ss]`, `[mm:ss.xx]` and `[mm:ss:xx]` are all in circulation, and the
// fraction runs to two or three digits. Anchored per match rather than globally
// so several can be peeled off one line.
const TIMESTAMP = /^\[(\d{1,3}):([0-5]?\d)(?:[.:](\d{1,3}))?\]/;

// The `[xx:...]` metadata tags. Only `offset` changes what is drawn -- it is
// milliseconds to *subtract*, which is the opposite sign to the one everybody
// assumes, and it is how a tagger corrects a whole file that runs early.
const ID_TAG = /^\[([a-z]{2,8}):(.*)\]$/i;

// A fraction is not always hundredths: `[00:12.5]` is five tenths and
// `[00:12.500]` is five hundred milliseconds. Pad rather than divide by a
// guessed power of ten.
const fractionSeconds = (digits: string | undefined) =>
	digits ? Number(digits.padEnd(3, "0")) / 1000 : 0;

interface SourceLine {
	times: number[];
	text: string;
}

// One tag line can carry several timestamps -- `[00:02.68][00:13.88]I never
// meant to` is a refrain sung twice, and it is common enough in real files that
// reading only the first would silently drop half the second chorus.
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

// Enough timestamps that the file is meant to be followed, rather than a plain
// lyric that happens to open with something in brackets. Both halves are load
// bearing: the floor rejects `[Chorus]`-style section headers on an otherwise
// untimed lyric, and the majority rejects a file where one line was timed by
// accident.
const SYNCED_MINIMUM = 3;
const SYNCED_SHARE = 0.5;

// ...and the timestamps have to go somewhere. *Measured*, the counts alone get
// this wrong: a large minority of tagged tracks are NetEase rips whose whole
// lyric is two credit lines and `纯音乐，请欣赏` -- three timestamps, all inside
// the first five seconds of a four-minute track. Counted, that is a synced
// lyric; drawn, it is a karaoke view that fires three times and then sits dead
// for the rest of the song. Worse, the *same* boilerplate appears with one or
// two lines elsewhere in the library, so a count threshold classifies identical
// content two different ways.
//
// The question is not what the words say -- Jean does not read tags to judge
// them -- it is whether the *timing* is followable, and timestamps that never
// leave the opening bars are not. Twenty seconds sits an order of magnitude
// above every boilerplate file measured and far below any real lyric.
const SYNCED_MIN_SPAN = 20;

export function parseLyrics(raw: string | null | undefined): Lyrics {
	if (!raw) return NO_LYRICS;

	// `\r\n` throughout the measured library, and a lone `\r` in older taggers.
	const rows = raw.split(/\r\n|\r|\n/);

	let offset = 0;
	const source: SourceLine[] = [];

	for (const row of rows) {
		const trimmed = row.trim();
		const line = peel(trimmed);

		// A metadata tag only counts as one where no timestamp was peeled off:
		// `[00:01.00]作词 : ...` is a timed line whose text happens to hold a colon.
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
				// Clamped at zero: an offset larger than the first timestamp would
				// otherwise sort a line before the track starts, where nothing can
				// ever make it current.
				times.map((at) => ({ at: Math.max(0, at - offset), text })),
			)
			.sort((a, b) => a.at - b.at);

		const span = lines[lines.length - 1].at - lines[0].at;
		if (span >= SYNCED_MIN_SPAN) return { kind: "synced", lines };
	}

	// Trailing blanks are the tagger's, not the writer's; interior ones are a
	// stanza break and stay.
	const lines = source.map((line) => line.text);
	while (lines.length > 0 && !lines[lines.length - 1]) lines.pop();
	while (lines.length > 0 && !lines[0]) lines.shift();

	return lines.length === 0 ? NO_LYRICS : { kind: "plain", lines };
}

/**
 * Which line is current at `position`, as an index into `lines`, or -1 before
 * the first one.
 *
 * A binary search rather than a scan: this is asked on every animation frame
 * the screen is open, and a long lyric is a few hundred lines.
 */
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
