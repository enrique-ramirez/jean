import type { TrackColumns } from "@/shared/api/types";
import { plural } from "@/shared/lib/text";
import { FIELD, numberOf, tagKey, value } from "./fields";

// What a header's row of chips has room for; callers wanting more pass their own.
const TOP_GENRES = 4;
const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// A genre is the tag taken whole, since foobar joins multiple values with '; ', and it is counted through `tagKey` so `Rock` and `rock` are not two genres.
// One pass with a mutable accumulator: this runs over the whole library again for every chunk that lands.
export function summarise(
	rows: TrackColumns[],
	playedCount = 0,
	{ genres = TOP_GENRES } = {},
) {
	const totals = rows.reduce(
		(into, row) => {
			into.seconds += numberOf(row, FIELD.duration) ?? 0;

			const year = numberOf(row, FIELD.year);
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
			.slice(0, genres)
			.map(({ name, count }) => ({
				name,
				count,
				share: Math.round((count / rows.length) * 100),
			})),
		playedShare: rows.length > 0 ? playedCount / rows.length : 0,
	};
}

export type TrackStats = ReturnType<typeof summarise>;

const breakDown = (seconds: number) =>
	Number.isFinite(seconds) && seconds > 0
		? {
				days: Math.floor(seconds / DAY),
				hours: Math.floor((seconds % DAY) / HOUR),
				minutes: Math.floor((seconds % HOUR) / MINUTE),
			}
		: null;

// Human units, biggest first, never more than two. Days rather than months, which are not a fixed length.
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
