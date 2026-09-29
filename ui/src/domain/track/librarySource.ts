import type { QueueSource } from "@/domain/player/queue";
import { libraryArtworkUrl, playlistRowArtworkUrl } from "@/shared/api/artwork";
import { requireFooJean } from "@/shared/api/discovery";
import { encodeFill, runsOf } from "@/shared/api/fillEncoding";
import { libraryPathMatcher } from "@/shared/api/playerState";
import {
	copyPlaylistRows,
	type FillOwnPlaylistRequest,
	type FillPlaylistRequest,
	fillOwnPlaylist,
	fillPlaylist,
} from "@/shared/api/playlists";
import type {
	PlaybackPosition,
	TrackAddress,
	TrackIdentity,
} from "@/shared/api/types";
import {
	type AlbumCanonicalIndex,
	albumCanonicalIndex,
	canonicalTrackRefs,
} from "./grouping";
import type { LibraryColumns } from "./libraryColumns";
import { positionOf } from "./libraryIndex";
import type { PathTable } from "./pathTable";
import {
	componentLibraryKey,
	type PlaylistSnapshot,
	playlistSnapshot,
} from "./playlistStore";
import type { Refs } from "./project";

export interface AddedRows {
	positions: number[];
	structure: string;
}

export interface LibrarySourceCommon {
	playlistId: string | null;

	// A row the media library carries no path for still has a position: `playlistRowArtworkUrl`'s
	// fallback route.
	artworkUrl: (ref: number) => string | null;

	addresses: (ref: number) => TrackAddress[];
	address: (ref: number) => TrackAddress | null;
	addTo: (targetId: string, refs: Refs) => Promise<AddedRows>;
	queueTargets: (refs: Refs) => Promise<QueueSource>;
	playingPosition: (
		refs: Refs,
		track: TrackIdentity | null | undefined,
		activeItem?: PlaybackPosition | null,
	) => number;
}

export type LibrarySource =
	| (LibrarySourceCommon & {
			kind: "library";
			// `target` is the title to give the scratch playlist: the component resolves and titles that
			// playlist itself, in the same call that fills it, so there is no id to pass in ahead of the
			// call. Answers the GUID the fill landed in and the structure it left the playlist at, or
			// null where the caller must resolve the id another way.
			fill: (target: string, refs: Refs) => Promise<Filled | null>;
	  })
	| (LibrarySourceCommon & { kind: "playlist" });

interface MediaLibraryOptions {
	paths: PathTable;
	subsongs: Int32Array;
	artworkOrigin: string | null;
}

type PlaylistAddresses =
	| { paths: PathTable; subsongs: Int32Array }
	| { paths?: undefined; subsongs?: undefined };

export interface Filled {
	id: string;
	structure: string;
}

type PlaylistOptions = PlaylistAddresses & {
	playlistId: string;
	origin?: string | null;
	// ARCHITECTURE.md, *The two seams*: the generation the rows on screen were read at.
	structure?: string | null;
};

export type LibrarySourceOptions =
	| ({ kind: "library" } & MediaLibraryOptions)
	| ({ kind: "playlist" } & PlaylistOptions);

const fillScratch =
	(paths: PathTable, origin: string | null, structure: number) =>
	async (title: string, refs: Refs): Promise<Filled | null> => {
		if (!origin) return null;

		const request: FillOwnPlaylistRequest = {
			title,
			...encodeFill(refs, { structure, trackCount: paths.length }),
		};

		const result = await fillOwnPlaylist(origin, "scratch", request);
		return { id: result.playlistId, structure: result.structure };
	};

const addToPlaylist =
	(paths: PathTable, origin: string | null, structure: number) =>
	async (targetId: string, refs: Refs): Promise<AddedRows> => {
		const required = requireFooJean(origin);

		const request: FillPlaylistRequest = encodeFill(refs, {
			structure,
			trackCount: paths.length,
		});

		const result = await fillPlaylist(required, targetId, request);
		return { positions: result.positions, structure: result.structure };
	};

const queueLibraryTracks =
	(paths: PathTable, structure: number) =>
	async (refs: Refs): Promise<QueueSource> => ({
		kind: "tracks",
		request: encodeFill(refs, { structure, trackCount: paths.length }),
	});

// One album, one address, everywhere: a cover is asked for at its record's earliest track rather than
// whichever row a view happened to reach it through. Keyed by `LibraryColumns` identity, which changes
// only when a chunk lands or the library rebuilds, so a scroll or a re-render costs nothing here.
const canonicalRefsByColumns = new WeakMap<LibraryColumns, Int32Array>();

const canonicalRefsOf = (columns: LibraryColumns): Int32Array => {
	let refs = canonicalRefsByColumns.get(columns);
	if (!refs) {
		refs = canonicalTrackRefs(columns);
		canonicalRefsByColumns.set(columns, refs);
	}
	return refs;
};

// The playlist source only ever knows a row's own path, never its tags, so the same canonicalisation
// is reached through the library snapshot's own paths instead of through refs -- a playlist need not
// hold the record's earliest track for this to still find it.
const canonicalPathsByColumns = new WeakMap<
	LibraryColumns,
	Map<string, string>
>();

const canonicalPathOf = (snapshot: PlaylistSnapshot, path: string): string => {
	const paths = snapshot.paths;
	if (!paths) return path;

	let byPath = canonicalPathsByColumns.get(snapshot.columns);
	if (!byPath) {
		byPath = new Map<string, string>();
		const refs = canonicalRefsOf(snapshot.columns);
		for (let ref = 0; ref < refs.length; ref += 1) {
			const own = paths.at(ref);
			const canonical = own ? paths.at(refs[ref]) : "";
			if (own && canonical) byPath.set(own, canonical);
		}
		canonicalPathsByColumns.set(snapshot.columns, byPath);
	}

	return byPath.get(path) ?? path;
};

// `shared/api/README.md`, *What Jean does about the library*, has why both halves are asked.
export const libraryAddressesResolve = (
	origin: string | null,
	exportHeldWhenLibraryUnbuilt: number | null,
) => {
	if (origin === null) return false;

	const { structure, paths } = playlistSnapshot(componentLibraryKey(origin));
	return paths !== null && structure !== exportHeldWhenLibraryUnbuilt;
};

// The playing surfaces resolve a raw library path to its record's canonical one on the same terms a
// playlist row does, so the status bar, the now-playing screen and a playlist row never disagree
// about which address a shared record answers to.
export function canonicalArtworkUrl(
	origin: string | null,
	path: string,
): string | null {
	const snapshot = origin
		? playlistSnapshot(componentLibraryKey(origin))
		: null;
	return libraryArtworkUrl(
		origin,
		snapshot ? canonicalPathOf(snapshot, path) : path,
	);
}

// The playing surfaces already have the playing track's album and album artist, from
// `PlayerState.activeItem` on every poll tick: this resolves that to the record's canonical address
// against the library index already held, at no request of its own. Keyed by `LibraryColumns`
// identity, the same as the other per-snapshot caches above.
const albumIndexByColumns = new WeakMap<LibraryColumns, AlbumCanonicalIndex>();

const albumIndexOf = (columns: LibraryColumns): AlbumCanonicalIndex => {
	let index = albumIndexByColumns.get(columns);
	if (!index) {
		index = albumCanonicalIndex(columns);
		albumIndexByColumns.set(columns, index);
	}
	return index;
};

// `credited` is the album artist, falling back to the artist, the way the library groups them:
// the caller resolves that fallback, since only it knows which of the two strings it read.
export function canonicalPlayingArtworkUrl(
	origin: string | null,
	album: string,
	credited: string,
): string | null {
	if (!origin || !album) return null;

	const snapshot = playlistSnapshot(componentLibraryKey(origin));
	if (!snapshot.paths) return null;

	const ref = albumIndexOf(snapshot.columns).refFor(album, credited);
	if (ref === null) return null;

	const canonical = snapshot.paths.at(ref);
	return canonical ? libraryArtworkUrl(origin, canonical) : null;
}

const fromMediaLibrary = ({
	paths,
	subsongs,
	artworkOrigin,
}: MediaLibraryOptions): Extract<LibrarySource, { kind: "library" }> => {
	// Read once, alongside `paths`: `structure` and the canonical-ref table both describe the same
	// snapshot, and reading either again later could see a rebuild `paths` has not, resolving refs
	// against a generation they do not name.
	const snapshot = artworkOrigin
		? playlistSnapshot(componentLibraryKey(artworkOrigin))
		: null;
	const structure = snapshot ? snapshot.structure : 0;
	const canonicalRefs = snapshot ? canonicalRefsOf(snapshot.columns) : null;

	// The row's own path, never the album's canonical one `artworkUrl` asks for: a write lands on the
	// track under the cursor.
	const addresses = (ref: number): TrackAddress[] => {
		const track = paths.at(ref);
		return track
			? [
					{ kind: "library", track, subsong: subsongs[ref] ?? 0 },
					{ kind: "ordinal", ordinal: ref, structure },
				]
			: [];
	};

	return {
		kind: "library",
		playlistId: null,

		artworkUrl: (ref: number) =>
			libraryArtworkUrl(artworkOrigin, paths.at(canonicalRefs?.[ref] ?? ref)),

		addresses,
		address: (ref: number) => addresses(ref)[0] ?? null,

		fill: fillScratch(paths, artworkOrigin, structure),
		queueTargets: queueLibraryTracks(paths, structure),

		addTo: addToPlaylist(paths, artworkOrigin, structure),

		// Linear, where the playlist source bisects: path order is not ref order.
		playingPosition: (refs: Refs, track: TrackIdentity | null | undefined) => {
			if (!track?.path) return -1;
			const matches = libraryPathMatcher(track.path);
			const subsong = track.subsong ?? 0;
			return Array.prototype.findIndex.call(
				refs,
				(ref: number) => subsongs[ref] === subsong && matches(paths.at(ref)),
			);
		},
	};
};

const fromPlaylist = (
	options: PlaylistOptions,
): Extract<LibrarySource, { kind: "playlist" }> => {
	const { playlistId, origin = null, structure = null } = options;

	const addresses = (ref: number): TrackAddress[] => {
		const forms: TrackAddress[] = [];

		if (options.paths) {
			const track = options.paths.at(ref);
			if (track)
				forms.push({
					kind: "library",
					track,
					subsong: options.subsongs[ref] ?? 0,
				});
		}

		if (structure)
			forms.push({
				kind: "playlist",
				playlist: playlistId,
				index: ref,
				structure,
			});

		return forms;
	};

	return {
		kind: "playlist",
		playlistId,

		artworkUrl: (ref: number) => {
			if (!options.paths) return null;

			const path = options.paths.at(ref);
			if (path) return canonicalArtworkUrl(origin, path);

			return origin ? playlistRowArtworkUrl(origin, playlistId, ref) : null;
		},

		addresses,
		address: (ref: number) => addresses(ref)[0] ?? null,

		queueTargets: async (refs: Refs): Promise<QueueSource> => ({
			kind: "rows",
			targets: Array.from(refs, (ref) => ({ playlistId, itemIndex: ref })),
		}),
		addTo: async (targetId: string, refs: Refs): Promise<AddedRows> => {
			const required = requireFooJean(origin);
			return copyPlaylistRows(required, targetId, {
				source: playlistId,
				runs: runsOf(refs),
			});
		},

		// Index is identity in a playlist, so this can only answer while the player is inside the
		// playlist being browsed. Refs arrive ascending, so it bisects.
		playingPosition: (
			refs: Refs,
			_track: TrackIdentity | null | undefined,
			activeItem?: PlaybackPosition | null,
		) =>
			activeItem?.playlistId === playlistId
				? positionOf(refs, activeItem.index)
				: -1,
	};
};

export function librarySourceOf(
	options: Extract<LibrarySourceOptions, { kind: "library" }>,
): Extract<LibrarySource, { kind: "library" }>;
export function librarySourceOf(
	options: Extract<LibrarySourceOptions, { kind: "playlist" }>,
): Extract<LibrarySource, { kind: "playlist" }>;
export function librarySourceOf(options: LibrarySourceOptions): LibrarySource {
	return options.kind === "library"
		? fromMediaLibrary(options)
		: fromPlaylist(options);
}
