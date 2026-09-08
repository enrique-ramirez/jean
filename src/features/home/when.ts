import { datesIn, relativeIn } from "@/shared/i18n/format";

const DAY = 24 * 60 * 60 * 1000;

// A caption starts a line, and `Intl` capitalises nothing. An English relative phrase comes back
// lower-case and a Spanish month name is lower-case by convention. Which letter grows is the
// locale's business: Turkish dotted i is the case everyone gets wrong with `toUpperCase`.
const capitalise = (text: string, locale: string) =>
	text.charAt(0).toLocaleUpperCase(locale) + text.slice(1);

export function describeWhen(
	at: number | null | undefined,
	locale: string,
	today: string,
) {
	if (!at) return null;

	const relative = relativeIn(locale, { numeric: "auto" });
	const days = Math.floor((Date.now() - at) / DAY);

	if (days <= 0) return today;
	if (days < 7) return capitalise(relative.format(-days, "day"), locale);
	if (days < 35)
		return capitalise(relative.format(-Math.round(days / 7), "week"), locale);
	if (days < 365)
		return capitalise(relative.format(-Math.round(days / 30), "month"), locale);

	return capitalise(
		datesIn(locale, { month: "long", year: "numeric" }).format(at),
		locale,
	);
}

export const yearOf = (at: number | null | undefined) =>
	at ? new Date(at).getFullYear() : null;
