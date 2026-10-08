import { type ReactNode, useMemo } from "react";
import { type ArtistTracks, refsOfArtist } from "@/domain/artist/artists";
import { useSplitCredits } from "@/domain/artist/splitCredits";
import type { Library } from "@/domain/library/useLibrary";
import { AlbumCrumb } from "@/domain/track/AlbumCrumb";
import { albumsOf, refsOfAlbum } from "@/domain/track/albums";
import {
	albumLabel,
	SCRATCH_KIND,
	type ScratchKind,
} from "@/domain/track/jeanPlaylists";
import {
	EMPTY_VIEW,
	project,
	refsOfGenre,
	type TrackView,
	wholeLibrary,
} from "@/domain/track/project";
import { type ArtistTab, href, ROUTE } from "@/domain/track/routes";
import { buildShelves, refsOfShelf } from "@/features/home/shelves";
import { useTranslate } from "@/shared/i18n/useTranslate";
import { Crumb } from "@/shared/ui/Crumb";
import type { RouteView } from "./routes";

export interface ListPage {
	view: TrackView;
	kind: ScratchKind;
	label: string;
	eyebrow: ReactNode;
	title: string;
	emptyNotice: string;
}

export interface ArtistPage {
	name: string;
	tab: ArtistTab;
	tracks: ArtistTracks;
	view: TrackView;
}

const EMPTY_ARTIST_TRACKS: ArtistTracks = {
	own: new Int32Array(0),
	shared: new Int32Array(0),
	guest: new Int32Array(0),
	all: new Int32Array(0),
};

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

	const shelfView = useMemo(() => {
		if (!shelf || snapshot.columns.trackCount === 0) return null;
		const built = buildShelves(albumsOf(allMusic)).find(
			(entry) => entry.id === shelf.id,
		);
		return built ? project(snapshot, refsOfShelf(built)) : null;
	}, [shelf, snapshot, allMusic]);

	const genreView = useMemo(
		() =>
			genre ? project(snapshot, refsOfGenre(snapshot.columns, genre)) : null,
		[genre, snapshot],
	);

	const albumTracks = useMemo(
		() => (album ? refsOfAlbum(snapshot.columns, albumArtist, album) : null),
		[album, albumArtist, snapshot.columns],
	);

	const albumView = useMemo(
		() => (albumTracks ? project(snapshot, albumTracks.refs) : null),
		[albumTracks, snapshot],
	);

	const artistTracks = useMemo(
		() =>
			artist
				? refsOfArtist(snapshot.columns, artist, splitsCredits)
				: EMPTY_ARTIST_TRACKS,
		[artist, snapshot.columns, splitsCredits],
	);

	const artistView = useMemo(
		() => (artist ? project(snapshot, artistTracks.all) : null),
		[artist, snapshot, artistTracks.all],
	);

	const list: ListPage | null = shelf
		? {
				view: shelfView ?? EMPTY_VIEW,
				kind: SCRATCH_KIND.shelf,
				label: t(shelf.title),
				eyebrow: t("route.shelf"),
				title: t(shelf.title),
				emptyNotice: t("library.empty"),
			}
		: genre
			? {
					view: genreView ?? EMPTY_VIEW,
					kind: SCRATCH_KIND.genre,
					label: genre,
					eyebrow: (
						<Crumb href={href(ROUTE.genres)}>{t("home.allGenres")}</Crumb>
					),
					title: genre,
					emptyNotice: t("library.noGenre", { genre }),
				}
			: albumTracks
				? {
						view: albumView ?? EMPTY_VIEW,
						kind: SCRATCH_KIND.album,
						label: albumLabel(albumTracks.artist, albumTracks.album),
						eyebrow: <AlbumCrumb artist={albumTracks.artist} />,
						title: albumTracks.album,
						emptyNotice: t("library.noAlbum"),
					}
				: route.kind === "all"
					? {
							view: allMusic,
							kind: SCRATCH_KIND.all,
							label: "",
							eyebrow: t("home.yourLibrary"),
							title: t("library.allMusic"),
							emptyNotice: t("library.empty"),
						}
					: null;

	const artistPage: ArtistPage | null = artist
		? {
				name: artist,
				tab: artistTab,
				tracks: artistTracks,
				view: artistView ?? EMPTY_VIEW,
			}
		: null;

	return { allMusic, list, artist: artistPage };
}
