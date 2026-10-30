import { useMemo } from "react";
import type { ArtistTracks } from "@/domain/artist/artists";
import { useSplitCredits } from "@/domain/artist/splitCredits";
import {
	type QuestionFailed,
	questionFailed,
} from "@/domain/library/questionFailed";
import {
	type Library,
	useSetRows,
	useWindowedRows,
} from "@/domain/library/useLibrary";
import {
	atStructure,
	useLibrarySummary,
} from "@/domain/library/useLibrarySummary";
import { NO_WAIT, useWait, type Wait } from "@/domain/library/useOverdue";
import { AlbumCrumb } from "@/domain/track/AlbumCrumb";
import type { AlbumTracks } from "@/domain/track/albums";
import {
	albumLabel,
	SCRATCH_KIND,
	type ScratchKind,
} from "@/domain/track/jeanPlaylists";
import { type ListedRows, type Refs, wholeRefs } from "@/domain/track/project";
import { type ArtistTab, href, ROUTE } from "@/domain/track/routes";
import type { PageHeading } from "@/domain/track/TrackPage";
import { useLibraryQuestion } from "@/domain/track/useLibraryQuestion";
import { refsOfShelf } from "@/features/home/shelves";
import type { ArtistAnswered, SetFigures } from "@/shared/api/libraryQuestions";
import { type Translate, useTranslate } from "@/shared/i18n/useTranslate";
import { Crumb } from "@/shared/ui/Crumb";
import type { RouteView } from "./routes";

export interface ListPage {
	pageKey: string;
	view: ListedRows;
	kind: ScratchKind;
	label: string;
	heading: PageHeading & { title: string };
	emptyNotice: string;
	wait: Wait;
	figures: SetFigures | null;
	isAwaitingColumns: boolean;
	failure: QuestionFailed | null;
}

export interface ArtistPage {
	name: string;
	tab: ArtistTab;
	tracks: ArtistTracks;
	answered: ArtistAnswered | null;
	view: ListedRows;
	wait: Wait;
	isAwaitingColumns: boolean;
	failure: QuestionFailed | null;
}

const EMPTY_ARTIST_TRACKS: ArtistTracks = {
	own: new Int32Array(0),
	shared: new Int32Array(0),
	guest: new Int32Array(0),
	all: new Int32Array(0),
};

const failureOf = (sweep: {
	answer: unknown;
	failure: Pick<QuestionFailed, "reason"> | null;
	retry: () => void;
}) =>
	sweep.answer === null ? questionFailed(sweep.failure, sweep.retry) : null;

function mergedAscending({
	own,
	shared,
	guest,
}: Pick<ArtistTracks, "own" | "shared" | "guest">) {
	const sets = [own, shared, guest];
	const at = [0, 0, 0];
	const all = new Int32Array(own.length + shared.length + guest.length);
	for (let filled = 0; filled < all.length; filled += 1) {
		let from = -1;
		for (let set = 0; set < sets.length; set += 1)
			if (
				at[set] < sets[set].length &&
				(from < 0 || sets[set][at[set]] < sets[from][at[from]])
			)
				from = set;
		all[filled] = sets[from][at[from]];
		at[from] += 1;
	}
	return all;
}

interface ListViews {
	allMusic: ListedRows;
	shelfView: ListedRows;
	genreView: ListedRows;
	albumView: ListedRows;
	albumTracks: AlbumTracks | null;
	figures: Record<"all" | "shelf" | "genre" | "album", SetFigures | null>;
	isAwaitingColumns: boolean;
	genreFailure: QuestionFailed | null;
	albumFailure: QuestionFailed | null;
}

function listPageOf(
	route: RouteView,
	{
		allMusic,
		shelfView,
		genreView,
		albumView,
		albumTracks,
		figures,
		isAwaitingColumns,
		genreFailure,
		albumFailure,
	}: ListViews,
	wait: Wait,
	t: Translate,
): ListPage | null {
	switch (route.kind) {
		case "shelf":
			return {
				pageKey: `shelf:${route.shelf.id}`,
				view: shelfView,
				kind: SCRATCH_KIND.shelf,
				label: t(route.shelf.title),
				heading: { eyebrow: t("route.shelf"), title: t(route.shelf.title) },
				emptyNotice: t("shelf.empty"),
				wait,
				figures: figures.shelf,
				isAwaitingColumns,
				failure: null,
			};
		case "genre":
			if (!route.genre) return null;
			return {
				pageKey: `genre:${route.genre}`,
				view: genreView,
				kind: SCRATCH_KIND.genre,
				label: route.genre,
				heading: {
					eyebrow: (
						<Crumb href={href(ROUTE.genres)}>{t("home.allGenres")}</Crumb>
					),
					title: route.genre,
				},
				emptyNotice: t("library.noGenre", { genre: route.genre }),
				wait,
				figures: figures.genre,
				isAwaitingColumns: false,
				failure: genreFailure,
			};
		case "album":
			if (!albumTracks) return null;
			return {
				pageKey: `album:${route.album}`,
				view: albumView,
				kind: SCRATCH_KIND.album,
				label: albumLabel(albumTracks.artist, albumTracks.album),
				heading: {
					eyebrow: <AlbumCrumb artist={albumTracks.artist} />,
					title: albumTracks.album,
					showsCover: true,
				},
				emptyNotice: t("library.noAlbum"),
				wait,
				figures: figures.album,
				isAwaitingColumns: false,
				failure: albumFailure,
			};
		case "all":
			return {
				pageKey: "all",
				view: allMusic,
				kind: SCRATCH_KIND.all,
				label: "",
				heading: {
					eyebrow: t("home.yourLibrary"),
					title: t("library.allMusic"),
				},
				emptyNotice: t("library.empty"),
				wait: NO_WAIT,
				figures: figures.all,
				isAwaitingColumns: false,
				failure: null,
			};
		default:
			return null;
	}
}

const SUMMARY_ROUTES: ReadonlySet<RouteView["kind"]> = new Set([
	"all",
	"shelf",
	"genre",
	"album",
	"artist",
	"search",
]);

export function useRouteView(route: RouteView, library: Library) {
	const t = useTranslate();
	const [splitsCredits] = useSplitCredits();

	const shelf = route.kind === "shelf" ? route.shelf : null;
	const genre = route.kind === "genre" ? route.genre : null;
	const album = route.kind === "album" ? route.album : null;
	const albumArtist = route.kind === "album" ? route.artist : null;
	const artist = route.kind === "artist" ? route.artist : null;
	const artistTab = route.kind === "artist" ? route.tab : "overview";

	const { trackCount, structure } = library;
	const allMusicRefs = useMemo(
		() => ({
			get indices(): Refs {
				return wholeRefs(trackCount);
			},
		}),
		[trackCount],
	);
	const allMusicRows = useWindowedRows(library, true);

	const held = useLibrarySummary(library, {
		isWanted: SUMMARY_ROUTES.has(route.kind),
	});
	const summary = useMemo(
		() => atStructure(held, structure),
		[held, structure],
	);
	const shelfAnswer = useMemo(() => {
		if (!shelf || !library.key || trackCount === 0)
			return { refs: null, figures: null, isPending: false };
		if (!summary) return { refs: null, figures: null, isPending: true };
		const document = summary.shelves.find((entry) => entry.id === shelf.id);
		return {
			refs: document ? refsOfShelf(document) : null,
			figures: document?.figures ?? null,
			isPending: false,
		};
	}, [shelf, trackCount, library.key, summary]);
	const shelfView = useSetRows(library, "shelf", shelfAnswer.refs);

	const genreQuestion = useMemo(
		() => (genre ? ({ kind: "genre", genre } as const) : null),
		[genre],
	);
	const genreSweep = useLibraryQuestion(genreQuestion, library);
	const genreView = useSetRows(
		library,
		"genre",
		genreSweep.answer?.refs ?? null,
	);

	const albumQuestion = useMemo(
		() =>
			album ? ({ kind: "album", artist: albumArtist, album } as const) : null,
		[album, albumArtist],
	);
	const albumSweep = useLibraryQuestion(albumQuestion, library);
	const albumTracks = useMemo(
		() =>
			album
				? (albumSweep.answer ?? {
						refs: new Int32Array(0),
						album,
						artist: albumSweep.isWaiting ? albumArtist : null,
					})
				: null,
		[album, albumArtist, albumSweep.answer, albumSweep.isWaiting],
	);

	const albumView = useSetRows(library, "album", albumTracks?.refs ?? null);

	const artistQuestion = useMemo(
		() =>
			artist ? ({ kind: "artist", artist, splitsCredits } as const) : null,
		[artist, splitsCredits],
	);
	const artistSweep = useLibraryQuestion(artistQuestion, library);
	const artistTracks = useMemo(
		() =>
			artistSweep.answer
				? { ...artistSweep.answer, all: mergedAscending(artistSweep.answer) }
				: EMPTY_ARTIST_TRACKS,
		[artistSweep.answer],
	);
	const artistAnswer = artistSweep.answer;
	const artistAnswered = useMemo(
		(): ArtistAnswered | null =>
			artistAnswer
				? {
						figures: artistAnswer.figures,
						cards: artistAnswer.cards,
						records: artistAnswer.records,
					}
				: null,
		[artistAnswer],
	);

	const artistView = useSetRows(
		library,
		"artist",
		artist ? artistTracks.all : null,
	);

	const isAwaitingColumns = shelfAnswer.isPending;

	const wait = useWait(
		genreSweep.isWaiting ||
			albumSweep.isWaiting ||
			artistSweep.isWaiting ||
			isAwaitingColumns,
		`${route.kind}:${shelf?.id ?? genre ?? album ?? artist}`,
	);

	const list = listPageOf(
		route,
		{
			allMusic: allMusicRows,
			shelfView,
			genreView,
			albumView,
			albumTracks,
			figures: {
				all: summary,
				shelf: shelfAnswer.figures,
				genre: genreSweep.answer?.figures ?? null,
				album: albumSweep.answer?.figures ?? null,
			},
			isAwaitingColumns,
			genreFailure: failureOf(genreSweep),
			albumFailure: failureOf(albumSweep),
		},
		wait,
		t,
	);

	const artistPage: ArtistPage | null = artist
		? {
				name: artist,
				tab: artistTab,
				tracks: artistTracks,
				answered: artistAnswered,
				view: artistView,
				wait,
				isAwaitingColumns,
				failure: failureOf(artistSweep),
			}
		: null;

	return { allMusicRefs, list, artist: artistPage };
}
