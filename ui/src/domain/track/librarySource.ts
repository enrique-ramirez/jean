import type { QueueSource } from "@/domain/player/queue";
import { fetchLibraryNodes, libraryPathMatcher } from "@/shared/api/beefweb";
import type {
	FillOwnPlaylistRequest,
	FillPlaylistRequest,
} from "@/shared/api/fooJean";
import {
	copyPlaylistRows,
	encodeFill,
	fetchPlaylistRows,
	fillOwnPlaylist,
	fillPlaylist,
	libraryArtworkUrl,
	playlistRowArtworkUrl,
	requireFooJean,
	runsOf,
} from "@/shared/api/fooJean";
import type {
	PlaybackPosition,
	TrackColumns,
	TrackIdentity,
} from "@/shared/api/types";
import { FIELD, sameTagValue, value } from "./fields";
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

export interface ResolvedTrack {
	identity: TrackIdentity;
	columns: string[];
}

export interface AddedRows {
	positions: number[];
	structure: string;
}

export interface LibrarySourceCommon {
	playlistId: string | null;

	// A row the media library carries no path for still has a position: `playlistRowArtworkUrl`'s
	// fallback route.
	artworkUrl: (ref: number) => string | null;
	// Null when the ref no longer names the row it was read from: indices move, and the failure mode
	// is writing a tag to somebody else's file.
	identify: (
		ref: number,
		row: TrackColumns,
		columns?: string[],
	) => Promise<ResolvedTrack | null>;
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
			// call. Answers the GUID the fill landed in, or null where the caller must resolve it
			// another way.
			fill: (
				target: string,
				refs: Refs,
				options?: { token?: string },
			) => Promise<string | null>;
	  })
	| (LibrarySourceCommon & { kind: "playlist" });

export type LibrarySourceOptions =
	| {
			kind: "library";
			paths: PathTable;
			subsongs: Int32Array;
			artworkOrigin: string | null;
			token: string | null;
	  }
	| {
			kind: "playlist";
			playlistId: string;
			origin?: string | null;
			token?: string | null;
			// Null where the rows have not loaded, or have loaded with the empty string standing in
			// for a row whose track the media library does not hold: neither answers a cover.
			paths?: PathTable | null;
	  };

const fillScratch =
	(paths: PathTable, origin: string | null, structure: number) =>
	async (
		title: string,
		refs: Refs,
		{ token }: { token?: string } = {},
	): Promise<string | null> => {
		if (!origin || !token) return null;

		const request: FillOwnPlaylistRequest = {
			title,
			...encodeFill(refs, { structure, trackCount: paths.length }),
		};

		const result = await fillOwnPlaylist(origin, token, "scratch", request);
		return result.playlistId;
	};

const addToPlaylist =
	(
		paths: PathTable,
		origin: string | null,
		structure: number,
		token: string | null,
	) =>
	async (targetId: string, refs: Refs): Promise<AddedRows> => {
		const required = requireFooJean(origin, token);

		const request: FillPlaylistRequest = encodeFill(refs, {
			structure,
			trackCount: paths.length,
		});

		const result = await fillPlaylist(
			required.origin,
			required.token,
			targetId,
			request,
		);
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
	token,
}: {
	paths: PathTable;
	subsongs: Int32Array;
	artworkOrigin: string | null;
	token: string | null;
}): Extract<LibrarySource, { kind: "library" }> => {
	// Read once, alongside `paths`: `structure` and the canonical-ref table both describe the same
	// snapshot, and reading either again later could see a rebuild `paths` has not, resolving refs
	// against a generation they do not name.
	const snapshot = artworkOrigin
		? playlistSnapshot(componentLibraryKey(artworkOrigin))
		: null;
	const structure = snapshot ? snapshot.structure : 0;
	const canonicalRefs = snapshot ? canonicalRefsOf(snapshot.columns) : null;

	return {
		kind: "library",
		playlistId: null,

		artworkUrl: (ref: number) =>
			libraryArtworkUrl(artworkOrigin, paths.at(canonicalRefs?.[ref] ?? ref)),

		identify: async (
			ref: number,
			_row: TrackColumns,
			columns: string[] = [],
		) => {
			const held = paths.at(ref);
			if (!held) return null;

			const cut = held.lastIndexOf("/");
			const { items } = await fetchLibraryNodes(
				cut < 0 ? "" : held.slice(0, cut),
				["%path%", ...columns],
			);

			const subsong = subsongs[ref] ?? 0;
			const found = items.find(
				(node) =>
					node.type === "F" &&
					node.path === held &&
					(node.subsong ?? 0) === subsong,
			);
			if (!found?.columns) return null;

			return {
				identity: { path: found.columns[0] || null, subsong },
				columns: found.columns.slice(1),
			};
		},

		fill: fillScratch(paths, artworkOrigin, structure),
		queueTargets: queueLibraryTracks(paths, structure),

		addTo: addToPlaylist(paths, artworkOrigin, structure, token),

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

const fromPlaylist = ({
	playlistId,
	origin = null,
	token = null,
	paths = null,
}: {
	playlistId: string;
	origin?: string | null;
	token?: string | null;
	paths?: PathTable | null;
}): Extract<LibrarySource, { kind: "playlist" }> => ({
	kind: "playlist",
	playlistId,

	// The player resolves a pathless row's position to a handle of its own via
	// `playlistRowArtworkUrl`. `paths` itself null is a row not loaded yet rather than one
	// confirmed pathless, and draws nothing until it catches up.
	artworkUrl: (ref: number) => {
		if (!paths) return null;

		const path = paths.at(ref);
		if (path) return canonicalArtworkUrl(origin, path);

		return origin ? playlistRowArtworkUrl(origin, playlistId, ref) : null;
	},

	identify: async (ref: number, row: TrackColumns, columns: string[] = []) => {
		if (!origin || !token) return null;

		const { items } = await fetchPlaylistRows(
			origin,
			token,
			playlistId,
			ref,
			1,
			["%path%", "%subsong%", "%title%", ...columns],
		);
		const found = items[0]?.columns;
		if (!found || !sameTagValue(found[2], value(row, FIELD.title))) return null;

		return {
			identity: { path: found[0] || null, subsong: Number(found[1]) || 0 },
			columns: found.slice(3),
		};
	},

	queueTargets: async (refs: Refs): Promise<QueueSource> => ({
		kind: "rows",
		targets: Array.from(refs, (ref) => ({ playlistId, itemIndex: ref })),
	}),
	addTo: async (targetId: string, refs: Refs): Promise<AddedRows> => {
		const required = requireFooJean(origin, token);
		return copyPlaylistRows(required.origin, required.token, targetId, {
			source: playlistId,
			runs: runsOf(refs),
		});
	},

	// Index is identity in a playlist, so this can only answer while the player is inside the playlist
	// being browsed. Refs arrive ascending, so it bisects.
	playingPosition: (
		refs: Refs,
		_track: TrackIdentity | null | undefined,
		activeItem?: PlaybackPosition | null,
	) =>
		activeItem?.playlistId === playlistId
			? positionOf(refs, activeItem.index)
			: -1,
});

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
