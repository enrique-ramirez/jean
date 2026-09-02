import { useQuery } from "@tanstack/react-query";

import { useStoredState } from "@/shared/hooks/useStoredState";

// **The only thing in Jean that leaves the network, and it is off until asked.**
//
// Everything else here comes from the player, which is the rule: foobar is the
// source of truth. An artist biography is the one fact a local library
// genuinely does not hold, so it is worth fetching -- but a music player on a
// LAN quietly telling a third party what its owner is listening to is not a
// default anybody chose. It is a switch in Settings, off, and the panel says so
// rather than pretending the feature does not exist.
//
// Kept in `localStorage` rather than `/api/clientconfig` for now, alongside the
// `foo_jean` token, because the record beefweb serves is unauthenticated and
// this is a statement about the user's privacy.
export const ARTIST_INFO_KEY = "jean.artistInfo";

export const useArtistInfoEnabled = () =>
	useStoredState<boolean>(ARTIST_INFO_KEY, false);

export interface ArtistInfo {
	name: string;
	summary: string;
	// Where the words came from. Shown, not hidden: an encyclopaedia entry about
	// somebody's band should say which encyclopaedia.
	sourceName: string;
	sourceUrl: string;
	// MusicBrainz's own facts, which Wikipedia's summary does not reliably carry.
	kind: string | null;
	area: string | null;
	years: string | null;
}

// Both of these answer `Access-Control-Allow-Origin: *` with no key and no
// proxy -- *checked*, September 2026. Deezer does not, which is why it is not
// here despite being the obvious choice for artist images.
const MUSICBRAINZ = "https://musicbrainz.org/ws/2";
const WIKIPEDIA = "https://en.wikipedia.org/api/rest_v1/page/summary";

// MusicBrainz asks clients for a descriptive `User-Agent` and caps the service
// at roughly a request per second. **A browser cannot send one** -- `User-Agent`
// is a forbidden header name and `fetch` drops it silently -- so this relies on
// the browser's own. *Measured*: a real Chrome UA answers 200 and only the bare
// token `Mozilla/5.0` is refused with 403, which is their bot filter rather
// than the policy. Nothing here can do better, and an ignored header in the
// code would only look like it had.
//
// One artist costs three requests (search, detail, sitelink) plus Wikipedia's,
// which is why this is cached for a day rather than fetched per track change.

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

// The Wikipedia article title, out of the URL MusicBrainz links to. Since 2015
// MusicBrainz prefers linking *Wikidata* -- which bridges every language and is
// the reason this follows two hops rather than one.
async function wikipediaTitle(
	relations: MbArtist["relations"],
	signal: AbortSignal,
): Promise<string | null> {
	const urlOf = (type: string) =>
		relations?.find((relation) => relation.type === type)?.url?.resource;

	// Tried first and *measured* to be usually absent: of the 28 relation types
	// on Nirvana's entry there is no `wikipedia` at all, only `wikidata`. Kept
	// because older entries still carry it and it saves the second hop.
	const direct = urlOf("wikipedia");
	if (direct) return decodeURIComponent(direct.split("/wiki/")[1] ?? "");

	const wikidata = urlOf("wikidata");
	if (!wikidata) return null;

	const id = wikidata.split("/").pop();
	if (!id) return null;

	// `v1`. *Measured*: the `v0` path that most examples still show is a 404,
	// and this one answers `Access-Control-Allow-Origin: *`.
	const response = await fetch(
		`https://www.wikidata.org/w/rest.php/wikibase/v1/entities/items/${id}/sitelinks/enwiki`,
		{ signal, headers: { Accept: "application/json" } },
	);
	if (!response.ok) return null;
	const link = (await response.json()) as { title?: string };
	return link.title ?? null;
}

// What the open internet knows about an artist, or null -- which is an ordinary
// outcome rather than an error: no connection, no match, and no article are all
// common, and the panel says which rather than spinning.
export function useArtistInfo(artist: string | null | undefined) {
	const [isEnabled] = useArtistInfoEnabled();

	return useQuery({
		queryKey: ["artistInfo", artist],
		enabled: isEnabled && Boolean(artist),
		// An encyclopaedia entry does not change while you listen to the album, and
		// the rate limit is one request a second.
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
			// A low score is a name that merely shares a word. MusicBrainz scores out
			// of 100 and an exact name is 100; anything under this is a guess, and a
			// confident biography of the wrong band is worse than none.
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
