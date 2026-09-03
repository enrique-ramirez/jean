import { useQuery } from "@tanstack/react-query";

import { useStoredState } from "@/shared/hooks/useStoredState";

// The only outbound request in Jean, so it is off until switched on. Kept in `localStorage` rather than `/api/clientconfig`, which beefweb serves unauthenticated.
export const ARTIST_INFO_KEY = "jean.artistInfo";

export const useArtistInfoEnabled = () =>
	useStoredState<boolean>(ARTIST_INFO_KEY, false);

export interface ArtistInfo {
	name: string;
	summary: string;
	sourceName: string;
	sourceUrl: string;
	// MusicBrainz's own facts, which Wikipedia's summary does not reliably carry.
	kind: string | null;
	area: string | null;
	years: string | null;
}

// Both answer `Access-Control-Allow-Origin: *` with no key and no proxy. Deezer does not, which is why there are no artist images.
const MUSICBRAINZ = "https://musicbrainz.org/ws/2";
const WIKIPEDIA = "https://en.wikipedia.org/api/rest_v1/page/summary";

// MusicBrainz asks for a descriptive `User-Agent`, which a browser cannot send: it is a forbidden header name and `fetch` drops it silently, so this relies on the browser's own.

interface MbArtist {
	id: string;
	name: string;
	type?: string;
	area?: { name?: string };
	"life-span"?: { begin?: string; end?: string };
	relations?: { type: string; url?: { resource: string } }[];
	score?: number;
}

const lifeSpan = (artist: MbArtist) => {
	const begin = artist["life-span"]?.begin?.slice(0, 4);
	const end = artist["life-span"]?.end?.slice(0, 4);
	if (!begin) return null;
	return end ? `${begin}–${end}` : `${begin}–`;
};

// The Wikipedia article title, out of the URL MusicBrainz links to. MusicBrainz prefers linking Wikidata, hence the second hop.
async function wikipediaTitle(
	relations: MbArtist["relations"],
	signal: AbortSignal,
): Promise<string | null> {
	const urlOf = (type: string) =>
		relations?.find((relation) => relation.type === type)?.url?.resource;

	// Usually absent on modern entries, but it saves the second hop where it is there.
	const direct = urlOf("wikipedia");
	if (direct) return decodeURIComponent(direct.split("/wiki/")[1] ?? "");

	const wikidata = urlOf("wikidata");
	if (!wikidata) return null;

	const id = wikidata.split("/").pop();
	if (!id) return null;

	// `v1`: the `v0` path most examples still show is a 404.
	const response = await fetch(
		`https://www.wikidata.org/w/rest.php/wikibase/v1/entities/items/${id}/sitelinks/enwiki`,
		{ signal, headers: { Accept: "application/json" } },
	);
	if (!response.ok) return null;
	const link = (await response.json()) as { title?: string };
	return link.title ?? null;
}

/** What the open internet knows about an artist, or null. No connection, no match and no article are all ordinary outcomes rather than errors. */
export function useArtistInfo(artist: string | null | undefined) {
	const [isEnabled] = useArtistInfoEnabled();

	return useQuery({
		queryKey: ["artistInfo", artist],
		enabled: isEnabled && Boolean(artist),
		// MusicBrainz caps the service at roughly one request a second, and one artist costs three requests plus Wikipedia's.
		staleTime: 24 * 60 * 60 * 1000,
		gcTime: 24 * 60 * 60 * 1000,
		retry: false,
		queryFn: async ({ signal }): Promise<ArtistInfo | null> => {
			const found = await fetch(
				`${MUSICBRAINZ}/artist?query=${encodeURIComponent(`artist:${artist}`)}&fmt=json&limit=1`,
				{ signal, headers: { Accept: "application/json" } },
			);
			if (!found.ok) return null;

			const { artists } = (await found.json()) as { artists?: MbArtist[] };
			const match = artists?.[0];
			// MusicBrainz scores out of 100 and an exact name is 100; anything under this is a name that merely shares a word.
			if (!match || (match.score ?? 0) < 90) return null;

			const detailed = await fetch(
				`${MUSICBRAINZ}/artist/${match.id}?inc=url-rels&fmt=json`,
				{ signal, headers: { Accept: "application/json" } },
			);
			const full = detailed.ok ? ((await detailed.json()) as MbArtist) : match;

			const base: ArtistInfo = {
				name: full.name,
				summary: "",
				sourceName: "MusicBrainz",
				sourceUrl: `https://musicbrainz.org/artist/${match.id}`,
				kind: full.type ?? null,
				area: full.area?.name ?? null,
				years: lifeSpan(full),
			};

			const title = await wikipediaTitle(full.relations, signal);
			if (!title) return base;

			const summary = await fetch(`${WIKIPEDIA}/${encodeURIComponent(title)}`, {
				signal,
				headers: { Accept: "application/json" },
			});
			if (!summary.ok) return base;

			const page = (await summary.json()) as {
				extract?: string;
				content_urls?: { desktop?: { page?: string } };
			};

			return {
				...base,
				summary: page.extract ?? "",
				sourceName: page.extract ? "Wikipedia" : base.sourceName,
				sourceUrl:
					page.content_urls?.desktop?.page ??
					`https://en.wikipedia.org/wiki/${encodeURIComponent(title)}`,
			};
		},
	});
}
