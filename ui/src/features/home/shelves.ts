import type { SummaryAlbum } from "@/shared/api/librarySummary";
import type { Phrase } from "@/shared/i18n/en";
import type { Translate } from "@/shared/i18n/useTranslate";
import { describeWhen, yearOf } from "./when";

type ShelfPhrase = Extract<
	Phrase,
	`shelf.${string}.title` | `shelf.${string}.blurb`
>;

export interface Shelf {
	id: string;
	title: ShelfPhrase;
	blurb: ShelfPhrase;
	caption: (album: SummaryAlbum, t: Translate, locale: string) => string | null;
}

export interface DrawnShelf<A extends SummaryAlbum = SummaryAlbum>
	extends Shelf {
	albums: A[];
	isPending: boolean;
}

export const SHELVES: Shelf[] = [
	{
		id: "added",
		title: "shelf.added.title",
		blurb: "shelf.added.blurb",
		caption: (album, t, locale) =>
			describeWhen(album.added, locale, t("when.today")),
	},
	{
		id: "recent",
		title: "shelf.recent.title",
		blurb: "shelf.recent.blurb",
		caption: (album, t, locale) =>
			describeWhen(album.lastPlayed, locale, t("when.today")),
	},
	{
		id: "top",
		title: "shelf.top.title",
		blurb: "shelf.top.blurb",
		caption: (album, t) => t("shelf.plays", { count: Math.round(album.plays) }),
	},
	{
		id: "rated",
		title: "shelf.rated.title",
		blurb: "shelf.rated.blurb",
		caption: (album, t) =>
			t("shelf.ratedCaption", {
				rating: (album.rating ?? 0).toFixed(1),
				count: album.ratedCount,
			}),
	},
	{
		id: "loved",
		title: "shelf.loved.title",
		blurb: "shelf.loved.blurb",
		caption: (album, t) =>
			t("shelf.notSince", { year: yearOf(album.lastPlayed) ?? "" }),
	},
	{
		id: "upgrade",
		title: "shelf.upgrade.title",
		blurb: "shelf.upgrade.blurb",
		caption: (album, t) =>
			t("shelf.upgradeCaption", {
				bitrate: Math.round(album.bitrate ?? 0),
				plays: t("shelf.plays", { count: Math.round(album.plays) }),
			}),
	},
	{
		id: "unopened",
		title: "shelf.unopened.title",
		blurb: "shelf.unopened.blurb",
		caption: (album, t) =>
			t("view.trackCount", {
				count: album.trackCount,
				total: album.trackCount,
			}),
	},
];

const STARTER: Shelf = {
	id: "starter",
	title: "shelf.starter.title",
	blurb: "shelf.starter.blurb",
	caption: (album, t) =>
		t("view.trackCount", { count: album.trackCount, total: album.trackCount }),
};

export const catalogueEntry = (id: string): Shelf | undefined =>
	id === STARTER.id ? STARTER : SHELVES.find((entry) => entry.id === id);

// Library order, not the order the shelf is drawn in. Ascending is also the only form `encodeFill`
// can send as runs or a bitset, so a shelf costs one pair per album rather than one ordinal per row.
export function refsOfShelf(shelf: {
	albums: readonly { ordinals: readonly number[] }[];
}) {
	return Int32Array.from(
		shelf.albums.flatMap((album) => [...album.ordinals]),
	).sort();
}
