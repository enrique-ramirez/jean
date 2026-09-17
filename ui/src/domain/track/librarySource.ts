import { guidOf } from "@/domain/player/playlistJoin";
import type { QueueSource } from "@/domain/player/queue";
import {
	artworkUrl,
	copyPlaylistItems,
	fetchLibraryNodes,
	fetchPlaylistItems,
	libraryPathMatcher,
} from "@/shared/api/beefweb";
import type {
	FillOwnPlaylistRequest,
	FillPlaylistRequest,
	FillResult,
} from "@/shared/api/fooJean";
import {
	encodeFill,
	fetchPlaylistAnnotations,
	fillOwnPlaylist,
	fillPlaylist,
	libraryArtworkUrl,
} from "@/shared/api/fooJean";
import type {
	PlaybackPosition,
	TrackColumns,
	TrackIdentity,
} from "@/shared/api/types";
import { FIELD, sameTagValue, value } from "./fields";
import { positionOf } from "./libraryIndex";
import type { PathTable } from "./pathTable";
import { componentLibraryKey, playlistSnapshot } from "./playlistStore";
import type { Refs } from "./project";

export interface ResolvedTrack {
	identity: TrackIdentity;
	columns: string[];
}

export interface LibrarySourceCommon {
	playlistId: string | null;

	artworkUrl: (ref: number) => string | null;
	// Null when the ref no longer names the row it was read from: indices move, and the failure mode
	// is writing a tag to somebody else's file.
	identify: (
		ref: number,
		row: TrackColumns,
		columns?: string[],
	) => Promise<ResolvedTrack | null>;
	addTo: (targetId: string, refs: Refs) => Promise<unknown>;
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
			// call. Answers the beefweb id the fill landed in, or null where the caller must resolve it
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
	| { kind: "playlist"; playlistId: string };

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
		return result.beefwebId;
	};

const addToPlaylist =
	(
		paths: PathTable,
		origin: string | null,
		structure: number,
		token: string | null,
	) =>
	async (targetId: string, refs: Refs): Promise<FillResult> => {
		if (!origin || !token) throw new Error("foo_jean is not reachable");

		const annotations = await fetchPlaylistAnnotations(origin, token);
		const guid = guidOf(targetId, annotations);

		const request: FillPlaylistRequest = encodeFill(refs, {
			structure,
			trackCount: paths.length,
		});

		return fillPlaylist(origin, token, guid, request);
	};

const queueLibraryTracks =
	(paths: PathTable, structure: number) =>
	async (refs: Refs): Promise<QueueSource> => ({
		kind: "tracks",
		request: encodeFill(refs, { structure, trackCount: paths.length }),
	});

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
	// Read once, alongside `paths`: both describe the same snapshot, and reading `structure` again
	// later could see a rebuild `paths` has not, resolving refs against a generation they do not name.
	const structure = artworkOrigin
		? playlistSnapshot(componentLibraryKey(artworkOrigin)).structure
		: 0;

	return {
		kind: "library",
		playlistId: null,

		artworkUrl: (ref: number) =>
			libraryArtworkUrl(artworkOrigin, paths.at(ref)),

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
}: {
	playlistId: string;
}): Extract<LibrarySource, { kind: "playlist" }> => ({
	kind: "playlist",
	playlistId,

	artworkUrl: (ref: number) => artworkUrl(playlistId, ref),

	identify: async (ref: number, row: TrackColumns, columns: string[] = []) => {
		const { rows } = await fetchPlaylistItems(playlistId, ref, 1, [
			"%path%",
			"%subsong%",
			"%title%",
			...columns,
		]);
		const found = rows[0];
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
	addTo: (targetId: string, refs: Refs) =>
		copyPlaylistItems(playlistId, targetId, refs),

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
