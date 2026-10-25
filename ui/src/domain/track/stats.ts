import type { SetFigures } from "@/shared/api/libraryQuestions";
import { translate } from "@/shared/i18n/locale";
import {
	FIELD,
	genreGroups,
	lastPlayedIn,
	playCountsIn,
	readNumber,
} from "./fields";
import { byValue } from "./libraryColumns";
import type { TrackRows } from "./project";

const TOP_GENRES = 4;
const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export interface HeaderStats {
	trackCount: number;
	seconds: number;
	earliest: number | null;
	latest: number | null;
	albumCount?: number;
}

export const NO_FIGURES: SetFigures = {
	albumCount: 0,
	trackCount: 0,
	seconds: 0,
	earliestYear: null,
	latestYear: null,
};

export const statsOfFigures = (figures: SetFigures): HeaderStats => ({
	trackCount: figures.trackCount,
	seconds: figures.seconds,
	earliest: figures.earliestYear,
	latest: figures.latestYear,
	albumCount: figures.albumCount,
});

export function summarise(rows: TrackRows) {
	const { columns } = rows;
	const duration = columns.fields[FIELD.duration];
	const year = columns.fields[FIELD.year];
	const genre = columns.fields[FIELD.genre];

	const lengths = byValue(duration, readNumber);
	const years = byValue(year, readNumber);
	const tags = genreGroups(genre);
	const counts = new Int32Array(tags.keys.length);
	const playsOf = playCountsIn(columns);
	const playedAt = lastPlayedIn(columns);

	let seconds = 0;
	let earliest: number | null = null;
	let latest: number | null = null;
	let plays = 0;
	let unplayed = 0;
	let lastPlayed: number | null = null;
	let mostPlayed: { position: number; plays: number } | null = null;

	for (let position = 0; position < rows.length; position += 1) {
		const ref = rows.ref(position);

		seconds += lengths[duration.ids[ref]] ?? 0;

		const released = years[year.ids[ref]];
		if (released !== null && released > 1000) {
			earliest = earliest === null ? released : Math.min(earliest, released);
			latest = latest === null ? released : Math.max(latest, released);
		}

		const count = playsOf(ref) ?? 0;
		plays += count;
		if (count === 0) unplayed += 1;
		else if (count > 0 && (mostPlayed === null || count > mostPlayed.plays))
			mostPlayed = { position, plays: count };

		const at = playedAt(ref);
		if (at !== null && (lastPlayed === null || at > lastPlayed))
			lastPlayed = at;

		for (const group of tags.of[genre.ids[ref]]) counts[group] += 1;
	}

	const named = tags.keys
		.map((_, group) => ({ name: tags.names[group], count: counts[group] }))
		.filter((entry) => entry.count > 0)
		.sort((a, b) => b.count - a.count);

	return {
		trackCount: rows.length,
		seconds,
		earliest,
		latest,
		topGenres: named.slice(0, TOP_GENRES).map(({ name, count }) => ({
			name,
			count,
			share: Math.round((count / rows.length) * 100),
		})),
		playedShare: rows.length > 0 ? (rows.length - unplayed) / rows.length : 0,
		plays,
		unplayed,
		lastPlayed,
		mostPlayed,
	};
}

const breakDown = (seconds: number) =>
	Number.isFinite(seconds) && seconds > 0
		? {
				days: Math.floor(seconds / DAY),
				hours: Math.floor((seconds % DAY) / HOUR),
				minutes: Math.floor((seconds % HOUR) / MINUTE),
			}
		: null;

export function spellDuration(seconds: number) {
	const parts = breakDown(seconds);
	if (!parts) return null;

	const { days, hours, minutes } = parts;
	if (days > 0)
		return {
			lead: translate("span.days", { count: days }),
			trail: hours > 0 ? translate("span.hoursShort", { count: hours }) : null,
		};
	if (hours > 0)
		return {
			lead: translate("span.hours", { count: hours }),
			trail:
				minutes > 0 ? translate("span.minutesShort", { count: minutes }) : null,
		};
	return { lead: translate("span.minutes", { count: minutes }), trail: null };
}

export function formatDuration(seconds: number) {
	const parts = breakDown(seconds);
	if (!parts) return null;

	const { days, hours, minutes } = parts;
	if (days > 0)
		return `${translate("span.days", { count: days })} ${translate("span.hoursShort", { count: hours })}`;
	if (hours > 0)
		return `${translate("span.hoursShort", { count: hours })} ${translate("span.minutesShort", { count: minutes })}`;
	return translate("span.minutesShort", { count: minutes });
}
