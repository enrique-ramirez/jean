import type { Phrase } from "@/shared/i18n/en";

const ALBUM_PATTERN = "%album%|%discnumber%|%tracknumber%";
const ARTIST_PATTERN =
	"%album artist%|%date%|%album%|%discnumber%|%tracknumber%";
const TITLE_PATTERN = "%title%|%artist%";
const RELEASE_DATE_PATTERN =
	"%date%|%album artist%|%album%|%discnumber%|%tracknumber%";

export interface Ordering {
	id: string;
	label: Extract<Phrase, `playlist.sortBy.${string}`>;
	pattern: string;
}

export const ORDERINGS: readonly Ordering[] = [
	{ id: "album", label: "playlist.sortBy.album", pattern: ALBUM_PATTERN },
	{ id: "artist", label: "playlist.sortBy.artist", pattern: ARTIST_PATTERN },
	{ id: "title", label: "playlist.sortBy.title", pattern: TITLE_PATTERN },
	{
		id: "releaseDate",
		label: "playlist.sortBy.releaseDate",
		pattern: RELEASE_DATE_PATTERN,
	},
];
