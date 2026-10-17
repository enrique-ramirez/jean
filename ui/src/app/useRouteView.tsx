import { useMemo } from "react";
import type { ArtistTracks } from "@/domain/artist/artists";
import { useSplitCredits } from "@/domain/artist/splitCredits";
import type { Library } from "@/domain/library/useLibrary";
import {
	atStructure,
	useLibrarySummary,
} from "@/domain/library/useLibrarySummary";
import { NO_WAIT, useWait, type Wait } from "@/domain/library/useOverdue";
import { AlbumCrumb } from "@/domain/track/AlbumCrumb";
import type { AlbumTracks } from "@/domain/track/albums";
import { CREDIT_TAGS } from "@/domain/track/fields";
import {
	albumLabel,
	SCRATCH_KIND,
	type ScratchKind,
} from "@/domain/track/jeanPlaylists";
import { isLoaded } from "@/domain/track/libraryColumns";
import {
	EMPTY_VIEW,
	project,
	type TrackView,
	wholeLibrary,
} from "@/domain/track/project";
import { type ArtistTab, href, ROUTE } from "@/domain/track/routes";
import type { PageHeading } from "@/domain/track/TrackPage";
import { useLibraryAnswer } from "@/domain/track/useLibraryAnswer";
import { refsOfShelf } from "@/features/home/shelves";
import { type Translate, useTranslate } from "@/shared/i18n/useTranslate";
import { Crumb } from "@/shared/ui/Crumb";
import type { RouteView } from "./routes";

export interface ListPage {
	pageKey: string;
	view: TrackView;
	kind: ScratchKind;
	label: string;
	heading: PageHeading & { title: string };
	emptyNotice: string;
	wait: Wait;
	isAwaitingColumns: boolean;
}

export interface ArtistPage {
	name: string;
	tab: ArtistTab;
	tracks: ArtistTracks;
	view: TrackView;
	wait: Wait;
	isAwaitingColumns: boolean;
}

const EMPTY_ARTIST_TRACKS: ArtistTracks = {
	own: new Int32Array(0),
	shared: new Int32Array(0),
	guest: new Int32Array(0),
	all: new Int32Array(0),
};

interface ListViews {
	allMusic: TrackView;
	shelfView: TrackView | null;
	genreView: TrackView | null;
	albumView: TrackView | null;
	albumTracks: AlbumTracks | null;
	isAwaitingColumns: boolean;
}

function listPageOf(
	route: RouteView,
	{
		allMusic,
		shelfView,
		genreView,
		albumView,
		albumTracks,
		isAwaitingColumns,
	}: ListViews,
	wait: Wait,
	t: Translate,
): ListPage | null {
	switch (route.kind) {
		case "shelf":
			return {
				pageKey: `shelf:${route.shelf.id}`,
				view: shelfView ?? EMPTY_VIEW,
				kind: SCRATCH_KIND.shelf,
				label: t(route.shelf.title),
				heading: { eyebrow: t("route.shelf"), title: t(route.shelf.title) },
				emptyNotice: t("shelf.empty"),
				wait,
				isAwaitingColumns,
			};
		case "genre":
			if (!route.genre) return null;
			return {
				pageKey: `genre:${route.genre}`,
				view: genreView ?? EMPTY_VIEW,
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
				isAwaitingColumns: false,
			};
		case "album":
			if (!albumTracks) return null;
			return {
				pageKey: `album:${route.album}`,
				view: albumView ?? EMPTY_VIEW,
				kind: SCRATCH_KIND.album,
				label: albumLabel(albumTracks.artist, albumTracks.album),
				heading: {
					eyebrow: <AlbumCrumb artist={albumTracks.artist} />,
					title: albumTracks.album,
				},
				emptyNotice: t("library.noAlbum"),
				wait,
				isAwaitingColumns: false,
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
				isAwaitingColumns: false,
			};
		default:
			return null;
	}
}

export function useRouteView(route: RouteView, library: Library) {
	const t = useTranslate();
	const [splitsCredits] = useSplitCredits();
	const { snapshot } = library;

	const shelf = route.kind === "shelf" ? route.shelf : null;
	const genre = route.kind === "genre" ? route.genre : null;
	const album = route.kind === "album" ? route.album : null;
	const albumArtist = route.kind === "album" ? route.artist : null;
	const artist = route.kind === "artist" ? route.artist : null;
	const artistTab = route.kind === "artist" ? route.tab : "overview";

	const allMusic = useMemo(() => wholeLibrary(snapshot), [snapshot]);

	const summary = useLibrarySummary(library);
	const shelfAnswer = useMemo(() => {
		if (!shelf || !library.key || snapshot.columns.trackCount === 0)
			return { view: null, isPending: false };
		const document = atStructure(summary, snapshot.structure);
		if (!document) return { view: null, isPending: true };
		const held = document.shelves.find((entry) => entry.id === shelf.id);
		return {
			view: held ? project(snapshot, refsOfShelf(held)) : null,
			isPending: false,
		};
	}, [shelf, snapshot, library.key, summary]);

	const genreQuestion = useMemo(
		() => (genre ? ({ kind: "genre", genre } as const) : null),
		[genre],
	);
	const genreSweep = useLibraryAnswer(genreQuestion, library, false);
	const genreView = useMemo(
		() => (genreSweep.answer ? project(snapshot, genreSweep.answer) : null),
		[genreSweep.answer, snapshot],
	);

	const albumQuestion = useMemo(
		() =>
			album ? ({ kind: "album", artist: albumArtist, album } as const) : null,
		[album, albumArtist],
	);
	const albumSweep = useLibraryAnswer(albumQuestion, library, false);
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

	const albumView = useMemo(
		() => (albumTracks ? project(snapshot, albumTracks.refs) : null),
		[albumTracks, snapshot],
	);

	const artistQuestion = useMemo(
		() =>
			artist ? ({ kind: "artist", artist, splitsCredits } as const) : null,
		[artist, splitsCredits],
	);
	const artistSweep = useLibraryAnswer(artistQuestion, library, false);
	const artistTracks = artistSweep.answer ?? EMPTY_ARTIST_TRACKS;

	const artistView = useMemo(
		() => (artist ? project(snapshot, artistTracks.all) : null),
		[artist, snapshot, artistTracks.all],
	);

	const isAwaitingColumns =
		shelfAnswer.isPending ||
		(artist !== null && !isLoaded(snapshot.columns, CREDIT_TAGS));

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
			allMusic,
			shelfView: shelfAnswer.view,
			genreView,
			albumView,
			albumTracks,
			isAwaitingColumns,
		},
		wait,
		t,
	);

	const artistPage: ArtistPage | null = artist
		? {
				name: artist,
				tab: artistTab,
				tracks: artistTracks,
				view: artistView ?? EMPTY_VIEW,
				wait,
				isAwaitingColumns,
			}
		: null;

	return { allMusic, list, artist: artistPage };
}
