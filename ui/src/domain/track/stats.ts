import { translate } from "@/shared/i18n/locale";
import { FIELD, genreGroups, readNumber } from "./fields";
import { byValue } from "./libraryColumns";
import type { TrackRows } from "./project";

const TOP_GENRES = 4;
const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function summarise(
	rows: TrackRows,
	playedCount = 0,
	{ genres = TOP_GENRES } = {},
) {
	const { columns } = rows;
	const duration = columns.fields[FIELD.duration];
	const year = columns.fields[FIELD.year];
	const genre = columns.fields[FIELD.genre];

	const lengths = byValue(duration, readNumber);
	const years = byValue(year, readNumber);
	const tags = genreGroups(genre);
	const counts = new Int32Array(tags.keys.length);

	let seconds = 0;
	let earliest: number | null = null;
	let latest: number | null = null;
	let tagged = 0;

	for (let position = 0; position < rows.length; position += 1) {
		const ref = rows.ref(position);

		seconds += lengths[duration.ids[ref]] ?? 0;

		const released = years[year.ids[ref]];
		if (released !== null && released > 1000) {
			earliest = earliest === null ? released : Math.min(earliest, released);
			latest = latest === null ? released : Math.max(latest, released);
		}

		for (const group of tags.of[genre.ids[ref]]) {
			if (counts[group] === 0) tagged += 1;
			counts[group] += 1;
		}
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
		genreCount: tagged,
		topGenres: named.slice(0, genres).map(({ name, count }) => ({
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
