import { useQuery } from "@tanstack/react-query";

import { useStoredState } from "@/shared/hooks/useStoredState";

export const ARTIST_INFO_KEY = "jean.artistInfo";

export const useArtistInfoEnabled = () =>
	useStoredState<boolean>(ARTIST_INFO_KEY, false);

export interface ArtistInfo {
	name: string;
	summary: string;
	sourceName: string;
	sourceUrl: string;
	kind: string | null;
	area: string | null;
	years: string | null;
}

// foo_jean's page policy, kPageContentPolicy, lets the page connect to musicbrainz.org,
// www.wikidata.org and en.wikipedia.org and to no other host.
const MUSICBRAINZ = "https://musicbrainz.org/ws/2";
const WIKIPEDIA = "https://en.wikipedia.org/api/rest_v1/page/summary";

interface MbArtist {
	id: string;
	name: string;
	type?: string;
	area?: { name?: string };
	"life-span"?: { begin?: string; end?: string };
	relations?: { type: string; url?: { resource: string } }[];
	score?: number;
}

const askThirdParty = (url: string, signal: AbortSignal) =>
	fetch(url, {
		signal,
		referrerPolicy: "no-referrer",
		headers: { Accept: "application/json" },
	});

const httpsUrl = (url: string | undefined) => {
	try {
		return url && new URL(url).protocol === "https:" ? url : null;
	} catch {
		return null;
	}
};

const lifeSpan = (artist: MbArtist) => {
	const begin = artist["life-span"]?.begin?.slice(0, 4);
	const end = artist["life-span"]?.end?.slice(0, 4);
	if (!begin) return null;
	return end ? `${begin}–${end}` : `${begin}–`;
};

async function wikipediaTitle(
	relations: MbArtist["relations"],
	signal: AbortSignal,
): Promise<string | null> {
	const urlOf = (type: string) =>
		relations?.find((relation) => relation.type === type)?.url?.resource;

	const direct = urlOf("wikipedia");
	if (direct) return decodeURIComponent(direct.split("/wiki/")[1] ?? "");

	const wikidata = urlOf("wikidata");
	if (!wikidata) return null;

	const id = wikidata.split("/").pop();
	if (!id) return null;

	const response = await askThirdParty(
		`https://www.wikidata.org/w/rest.php/wikibase/v1/entities/items/${id}/sitelinks/enwiki`,
		signal,
	);
	if (!response.ok) return null;
	const link = (await response.json()) as { title?: string };
	return link.title ?? null;
}

export function useArtistInfo(artist: string | null | undefined) {
	const [isEnabled] = useArtistInfoEnabled();

	return useQuery({
		queryKey: ["artistInfo", artist],
		enabled: isEnabled && Boolean(artist),
		// MusicBrainz rate-limits to roughly one request a second, and one artist costs several.
		staleTime: 24 * 60 * 60 * 1000,
		gcTime: 24 * 60 * 60 * 1000,
		retry: false,
		queryFn: async ({ signal }): Promise<ArtistInfo | null> => {
			const found = await askThirdParty(
				`${MUSICBRAINZ}/artist?query=${encodeURIComponent(`artist:${artist}`)}&fmt=json&limit=1`,
				signal,
			);
			if (!found.ok) return null;

			const { artists } = (await found.json()) as { artists?: MbArtist[] };
			const match = artists?.[0];
			// MusicBrainz scores a match out of 100, and an exact name scores 100.
			if (!match || (match.score ?? 0) < 90) return null;

			const detailed = await askThirdParty(
				`${MUSICBRAINZ}/artist/${match.id}?inc=url-rels&fmt=json`,
				signal,
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

			const summary = await askThirdParty(
				`${WIKIPEDIA}/${encodeURIComponent(title)}`,
				signal,
			);
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
					httpsUrl(page.content_urls?.desktop?.page) ??
					`https://en.wikipedia.org/wiki/${encodeURIComponent(title)}`,
			};
		},
	});
}
