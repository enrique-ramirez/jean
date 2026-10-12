import { useQuery } from "@tanstack/react-query";

import { useStoredState } from "@/shared/hooks/useStoredState";
import { fieldsOf, textOf } from "@/shared/lib/untrusted";

const ARTIST_INFO_KEY = "jean.artistInfo";

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

interface MbRelation {
	type: string;
	resource: string;
}

interface MbArtist {
	id: string;
	name: string;
	kind: string | null;
	area: string | null;
	begin: string | null;
	end: string | null;
	relations: MbRelation[];
	score: number;
}

function relationOf(body: unknown): MbRelation[] {
	const relation = fieldsOf(body);
	const type = textOf(relation.type);
	const resource = textOf(fieldsOf(relation.url).resource);
	return type === null || resource === null ? [] : [{ type, resource }];
}

function artistOf(body: unknown): MbArtist | null {
	const artist = fieldsOf(body);
	const id = textOf(artist.id);
	const name = textOf(artist.name);
	if (id === null || name === null) return null;

	const span = fieldsOf(artist["life-span"]);
	return {
		id,
		name,
		kind: textOf(artist.type),
		area: textOf(fieldsOf(artist.area).name),
		begin: textOf(span.begin),
		end: textOf(span.end),
		relations: Array.isArray(artist.relations)
			? artist.relations.flatMap(relationOf)
			: [],
		score: typeof artist.score === "number" ? artist.score : 0,
	};
}

const askThirdParty = (url: string, signal: AbortSignal) =>
	fetch(url, {
		signal,
		referrerPolicy: "no-referrer",
		headers: { Accept: "application/json" },
	});

const WIKIPEDIA_HOSTS = ".wikipedia.org";

const wikipediaPage = (url: string | null) => {
	if (url === null) return null;
	try {
		const { protocol, hostname } = new URL(url);
		return protocol === "https:" && hostname.endsWith(WIKIPEDIA_HOSTS)
			? url
			: null;
	} catch {
		return null;
	}
};

const lifeSpan = (artist: MbArtist) => {
	const begin = artist.begin?.slice(0, 4);
	const end = artist.end?.slice(0, 4);
	if (!begin) return null;
	return end ? `${begin}–${end}` : `${begin}–`;
};

const unescaped = (escaped: string) => {
	try {
		return decodeURIComponent(escaped);
	} catch {
		return null;
	}
};

async function wikipediaTitle(
	relations: MbArtist["relations"],
	signal: AbortSignal,
): Promise<string | null> {
	const urlOf = (type: string) =>
		relations.find((relation) => relation.type === type)?.resource;

	const direct = urlOf("wikipedia");
	if (direct) return unescaped(direct.split("/wiki/")[1] ?? "");

	const wikidata = urlOf("wikidata");
	if (!wikidata) return null;

	const id = wikidata.split("/").pop();
	if (!id) return null;

	const response = await askThirdParty(
		`https://www.wikidata.org/w/rest.php/wikibase/v1/entities/items/${id}/sitelinks/enwiki`,
		signal,
	);
	if (!response.ok) return null;
	return textOf(fieldsOf(await response.json()).title);
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

			const { artists } = fieldsOf(await found.json());
			const match = Array.isArray(artists) ? artistOf(artists[0]) : null;
			// MusicBrainz scores a match out of 100, and an exact name scores 100.
			if (!match || match.score < 90) return null;

			const detailed = await askThirdParty(
				`${MUSICBRAINZ}/artist/${match.id}?inc=url-rels&fmt=json`,
				signal,
			);
			const full =
				(detailed.ok ? artistOf(await detailed.json()) : null) ?? match;

			const base: ArtistInfo = {
				name: full.name,
				summary: "",
				sourceName: "MusicBrainz",
				sourceUrl: `https://musicbrainz.org/artist/${match.id}`,
				kind: full.kind,
				area: full.area,
				years: lifeSpan(full),
			};

			const title = await wikipediaTitle(full.relations, signal);
			if (!title) return base;

			const summary = await askThirdParty(
				`${WIKIPEDIA}/${encodeURIComponent(title)}`,
				signal,
			);
			if (!summary.ok) return base;

			const page = fieldsOf(await summary.json());
			const extract = textOf(page.extract) ?? "";
			const desktop = fieldsOf(fieldsOf(page.content_urls).desktop);

			return {
				...base,
				summary: extract,
				sourceName: extract ? "Wikipedia" : base.sourceName,
				sourceUrl:
					wikipediaPage(textOf(desktop.page)) ??
					`https://en.wikipedia.org/wiki/${encodeURIComponent(title)}`,
			};
		},
	});
}
