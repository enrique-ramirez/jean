import type { TrackColumns } from "@/shared/api/types";
import { plural } from "@/shared/lib/text";
import { FIELD, number, tagKey, value } from "./fields";

const TOP_GENRES = 4;
const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// A genre is the tag taken whole -- foobar joins values with '; ', and Jean does
// not get to decide somebody's tag is really two tags. Counted through `tagKey`
// so a portrait does not report `Rock` and `rock` as two genres, which would be
// measuring the tagging rather than the music.

// One implementation for a playlist header, a set of results and the front door,
// so the same library cannot be described two ways two centimetres apart. One
// pass with a mutable accumulator: this runs over the whole library again for
// every chunk that lands.
export function summarise(rows: TrackColumns[], playedCount = 0) {
	const totals = rows.reduce(
		(into, row) => {
			into.seconds += number(row, FIELD.duration) ?? 0;

			const year = number(row, FIELD.year);
			if (year !== null && year > 1000) {
				into.earliest =
					into.earliest === null ? year : Math.min(into.earliest, year);
				into.latest = into.latest === null ? year : Math.max(into.latest, year);
			}

			const genre = value(row, FIELD.genre);
			if (genre) {
				const key = tagKey(genre);
				const seen = into.genres.get(key);
				if (seen) seen.count += 1;
				else into.genres.set(key, { name: genre, count: 1 });
			}

			return into;
		},
		{
			seconds: 0,
			earliest: null as number | null,
			latest: null as number | null,
			genres: new Map<string, { name: string; count: number }>(),
		},
	);

	return {
		trackCount: rows.length,
		seconds: totals.seconds,
		earliest: totals.earliest,
		latest: totals.latest,
		genreCount: totals.genres.size,
		topGenres: [...totals.genres.values()]
			.sort((a, b) => b.count - a.count)
			.slice(0, TOP_GENRES)
			.map(({ name, count }) => ({
				name,
				share: Math.round((count / rows.length) * 100),
			})),
		playedShare: rows.length > 0 ? playedCount / rows.length : 0,
	};
}

// What a header is handed. Inferred from `summarise`, so a figure added there
// reaches every header without being declared twice.
export type TrackStats = ReturnType<typeof summarise>;

const breakDown = (seconds: number) =>
	Number.isFinite(seconds) && seconds > 0
		? {
				days: Math.floor(seconds / DAY),
				hours: Math.floor((seconds % DAY) / HOUR),
				minutes: Math.floor((seconds % HOUR) / MINUTE),
			}
		: null;

// Human units, biggest first, never more than two. Days rather than months,
// because a month is not a fixed length and nobody can picture "2.8 months of
// music".
export function spellDuration(seconds: number) {
	const parts = breakDown(seconds);
	if (!parts) return null;

	const { days, hours, minutes } = parts;
	if (days > 0)
		return {
			lead: plural(days, "day"),
			trail: hours > 0 ? `${hours} hr` : null,
		};
	if (hours > 0)
		return {
			lead: plural(hours, "hour"),
			trail: minutes > 0 ? `${minutes} min` : null,
		};
	return { lead: plural(minutes, "minute"), trail: null };
}

export function formatDuration(seconds: number) {
	const parts = breakDown(seconds);
	if (!parts) return null;

	const { days, hours, minutes } = parts;
	if (days > 0) return `${plural(days, "day")} ${hours} hr`;
	if (hours > 0) return `${hours} hr ${minutes} min`;
	return `${minutes} min`;
}
