const DAY = 24 * 60 * 60 * 1000;

// `numeric: 'auto'` is what turns "1 day ago" into "yesterday".
const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
const monthAndYear = new Intl.DateTimeFormat(undefined, {
	month: "long",
	year: "numeric",
});

const capitalise = (text: string) =>
	text.charAt(0).toUpperCase() + text.slice(1);

export function describeWhen(at: number | null | undefined) {
	if (!at) return null;

	const days = Math.floor((Date.now() - at) / DAY);
	if (days <= 0) return "Today";
	if (days < 7) return capitalise(relative.format(-days, "day"));
	if (days < 35)
		return capitalise(relative.format(-Math.round(days / 7), "week"));
	if (days < 365)
		return capitalise(relative.format(-Math.round(days / 30), "month"));
	return monthAndYear.format(at);
}

export const yearOf = (at: number | null | undefined) =>
	at ? new Date(at).getFullYear() : null;
