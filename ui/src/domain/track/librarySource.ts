import type { QueueTarget } from "@/domain/player/queue";
import {
	artworkUrl,
	copyPlaylistItems,
	fetchLibraryNodes,
	fetchPlaylistItems,
	fetchPlaylists,
	libraryPathMatcher,
	removePlaylistItems,
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
import { QUEUE_TITLE } from "./jeanPlaylists";
import { positionOf } from "./libraryIndex";
import type { PathTable } from "./pathTable";
import { componentLibraryKey, playlistSnapshot } from "./playlistStore";
import type { Refs } from "./project";

export interface ResolvedTrack {
	identity: TrackIdentity;
	columns: string[];
}

export interface HoldingPlaylist {
	id: string;
	itemCount: number;
}

export interface LibrarySource {
	kind: "library" | "playlist";
	playlistId: string | null;
	// Whether `fill` needs the target's live item count, which has to be read fresh: emptying is a
	// remove-by-range, and a cached count is stale from the first write on.
	needsHeldCount: boolean;

	artworkUrl: (ref: number) => string | null;
	// Null when the ref no longer names the row it was read from: indices move, and the failure mode
	// is writing a tag to somebody else's file.
	identify: (
		ref: number,
		row: TrackColumns,
		columns?: string[],
	) => Promise<ResolvedTrack | null>;
	// `target` is the beefweb id to append into for a playlist source, and the title to give the
	// scratch playlist for a library source: the component resolves and titles that playlist itself,
	// in the same call that fills it, so there is no id to pass in ahead of the call. Answers the
	// beefweb id the fill landed in, or null where the caller must resolve it another way.
	fill: (
		target: string,
		refs: Refs,
		options?: { heldCount?: number; token?: string },
	) => Promise<string | null>;
	addTo: (targetId: string, refs: Refs) => Promise<unknown>;
	// Targets come back in the order asked for.
	queueTargets: (
		refs: Refs,
		holding: () => Promise<HoldingPlaylist | null>,
		options?: { token?: string },
	) => Promise<QueueTarget[]>;
	playingPosition: (
		refs: Refs,
		track: TrackIdentity | null | undefined,
		activeItem?: PlaybackPosition | null,
	) => number;
}

export type LibrarySourceOptions =
	| {
			kind: "library";
			paths: PathTable;
			subsongs: Int32Array;
			artworkOrigin: string | null;
			token: string | null;
	  }
	| { kind: "playlist"; playlistId: string };

// The component resolves `own/scratch` to its own playlist and titles it in the same call that
// fills it, so there is never a beefweb id to address ahead of time. `structure` is read once,
// alongside `paths`, so the two describe the same snapshot the caller's refs were resolved against.
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

// A user's playlist is addressed by foobar2000's own GUID, from `PlaylistAnnotation.id`, which is
// not the beefweb id this seam is handed. The target already exists and beefweb already knows it, so
// the join is a plain lookup rather than the lazy-id wait `fetchPlaylistAnnotations` warns about.
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
		const guid = annotations?.find((entry) => entry.beefwebId === targetId)?.id;
		if (!guid)
			throw new Error(`no foo_jean playlist for beefweb id ${targetId}`);

		const request: FillPlaylistRequest = encodeFill(refs, {
			structure,
			trackCount: paths.length,
		});

		return fillPlaylist(origin, token, guid, request);
	};

const fillByCopy =
	(sourceId: string) =>
	async (targetId: string, refs: Refs, { heldCount = 0 } = {}) => {
		if (heldCount > 0) {
			await removePlaylistItems(
				targetId,
				Array.from({ length: heldCount }, (_, at) => at),
			);
		}
		await copyPlaylistItems(sourceId, targetId, refs);
		return targetId;
	};

// The component resolves `own/queue` to its own playlist the same way it resolves the scratch, and
// answers where each row landed, so there is nothing here to read back or match by path: `positions`
// names where `refs` landed, in the order `refs` was given. `holding` still runs first, for its one
// remaining job of clearing the playlist when the play queue that pointed into it is already empty.
const queueViaHolding =
	(paths: PathTable, origin: string | null, structure: number) =>
	async (
		refs: Refs,
		holding: () => Promise<HoldingPlaylist | null>,
		{ token }: { token?: string } = {},
	): Promise<QueueTarget[]> => {
		if (!origin || !token || refs.length === 0) return [];

		await holding();

		const request: FillOwnPlaylistRequest = {
			title: QUEUE_TITLE,
			...encodeFill(refs, { structure, trackCount: paths.length }),
		};

		const result = await fillOwnPlaylist(origin, token, "queue", request);
		// `beefwebId` is null only where this call made the playlist and beefweb has not looked again
		// yet, exactly as `fillScratch` above: the fresh list this falls back to is what makes it.
		const beefwebId =
			result.beefwebId ??
			(await fetchPlaylists()).find((entry) => entry.title === QUEUE_TITLE)
				?.id ??
			null;
		if (!beefwebId) return [];

		return Array.from(result.positions, (itemIndex) => ({
			playlistId: beefwebId,
			itemIndex,
		}));
	};

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
}): LibrarySource => {
	// Read once, alongside `paths`: both describe the same snapshot, and reading `structure` again
	// later could see a rebuild `paths` has not, resolving refs against a generation they do not name.
	const structure = artworkOrigin
		? playlistSnapshot(componentLibraryKey(artworkOrigin)).structure
		: 0;

	return {
		kind: "library",
		playlistId: null,
		needsHeldCount: false,

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
		queueTargets: queueViaHolding(paths, artworkOrigin, structure),

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
}): LibrarySource => ({
	kind: "playlist",
	playlistId,
	needsHeldCount: true,

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

	fill: fillByCopy(playlistId),

	queueTargets: async (refs: Refs) =>
		Array.from(refs, (ref) => ({ playlistId, itemIndex: ref })),
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

export const librarySourceOf = (
	options: LibrarySourceOptions,
): LibrarySource =>
	options.kind === "library"
		? fromMediaLibrary(options)
		: fromPlaylist(options);
