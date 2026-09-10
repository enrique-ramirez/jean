import type { QueueTarget } from "@/domain/player/queue";
import {
	addFromLibrary,
	artworkUrl,
	copyPlaylistItems,
	fetchLibraryNodes,
	fetchPlaylistItems,
	LIBRARY_SORT,
	libraryArtworkUrl,
	libraryPathMatcher,
	removePlaylistItems,
	sortPlaylistItems,
} from "@/shared/api/beefweb";
import type {
	PlaybackPosition,
	TrackColumns,
	TrackIdentity,
} from "@/shared/api/types";
import { inSequence } from "@/shared/lib/sequence";
import { FIELD, sameTagValue, value } from "./fields";
import { positionOf } from "./libraryIndex";
import type { PathTable } from "./pathTable";
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

	artworkUrl: (ref: number) => string;
	// Null when the ref no longer names the row it was read from: indices move, and the failure mode
	// is writing a tag to somebody else's file.
	identify: (
		ref: number,
		row: TrackColumns,
		columns?: string[],
	) => Promise<ResolvedTrack | null>;
	fill: (targetId: string, refs: Refs, heldCount?: number) => Promise<unknown>;
	addTo: (targetId: string, refs: Refs) => Promise<unknown>;
	// Targets come back in the order asked for.
	queueTargets: (
		refs: Refs,
		holding: () => Promise<HoldingPlaylist | null>,
	) => Promise<QueueTarget[]>;
	playingPosition: (
		refs: Refs,
		track: TrackIdentity | null | undefined,
		activeItem?: PlaybackPosition | null,
	) => number;
}

export type LibrarySourceOptions =
	| { kind: "library"; paths: PathTable; subsongs: Int32Array }
	| { kind: "playlist"; playlistId: string };

interface ItemChunk {
	items: { path: string; subsong: number }[];
	bytes: number;
}

// Array.from, never refs.map: refs can be an Int32Array, and mapping one gives back a typed array
// whose objects coerce to NaN.
const itemsFor = (paths: PathTable, subsongs: Int32Array, refs: Refs) =>
	Array.from(refs, (ref) => ({ path: paths.at(ref), subsong: subsongs[ref] }));

// TODO: fold into the endpoint migration rather than patch here. foobar2000 sorts by the path it is
// given, and this asks it for `%path%`, which is absolute, while an ordinal is ordered by the
// library-relative path. One root makes the two agree; more than one does not, and then a position
// computed from a row addresses a different track. Deciding what an ordinal is ordered by is the same
// question as which component fills the playlist, so it is settled when filling moves off beefweb.
const sortToLibraryOrder = (targetId: string) =>
	sortPlaylistItems(targetId, LIBRARY_SORT);

const MAX_BODY_BYTES = 768 * 1024;

const chunkedItems = (items: { path: string; subsong: number }[]) =>
	items.reduce<ItemChunk[]>((chunks, item) => {
		const open = chunks[chunks.length - 1];
		const size = JSON.stringify(item).length + 1;

		if (!open || open.bytes + size > MAX_BODY_BYTES)
			chunks.push({ items: [item], bytes: size });
		else {
			open.items.push(item);
			open.bytes += size;
		}

		return chunks;
	}, []);

const fillByLibrary =
	(paths: PathTable, subsongs: Int32Array) =>
	async (targetId: string, refs: Refs) => {
		// Omitting `items` means the whole library, in one request with no body.
		if (refs.length === paths.length) {
			await addFromLibrary(targetId, { replace: true });
			return sortToLibraryOrder(targetId);
		}

		// Sequential, and it has to be: only the first request may replace, and run concurrently that
		// replace could arrive last and empty what it filled.
		await inSequence(
			chunkedItems(itemsFor(paths, subsongs, refs)),
			(chunk, at) =>
				addFromLibrary(targetId, { items: chunk.items, replace: at === 0 }),
		);

		return sortToLibraryOrder(targetId);
	};

const fillByCopy =
	(sourceId: string) =>
	async (targetId: string, refs: Refs, heldCount = 0) => {
		if (heldCount > 0) {
			await removePlaylistItems(
				targetId,
				Array.from({ length: heldCount }, (_, at) => at),
			);
		}
		return copyPlaylistItems(sourceId, targetId, refs);
	};

const queueViaHolding =
	(paths: PathTable, subsongs: Int32Array) =>
	async (refs: Refs, holding: () => Promise<HoldingPlaylist | null>) => {
		const held = await holding();
		if (!held || refs.length === 0) return [];

		await addFromLibrary(held.id, { items: itemsFor(paths, subsongs, refs) });

		const landed = await fetchPlaylistItems(
			held.id,
			held.itemCount,
			refs.length,
			["%path%", "%subsong%"],
		);
		const landedRows = landed.rows.map((row) => ({
			matches: libraryPathMatcher(row[0]),
			subsong: Number(row[1]) || 0,
		}));
		const claimed = new Set<number>();

		return Array.from(refs, (ref) => {
			const path = paths.at(ref);
			const subsong = subsongs[ref] ?? 0;
			const at = landedRows.findIndex(
				(row, position) =>
					!claimed.has(position) &&
					row.subsong === subsong &&
					row.matches(path),
			);
			if (at < 0) return null;
			claimed.add(at);
			return { playlistId: held.id, itemIndex: held.itemCount + at };
		}).filter((target): target is QueueTarget => target !== null);
	};

const fromMediaLibrary = ({
	paths,
	subsongs,
}: {
	paths: PathTable;
	subsongs: Int32Array;
}): LibrarySource => ({
	kind: "library",
	playlistId: null,
	needsHeldCount: false,

	artworkUrl: (ref: number) => libraryArtworkUrl(paths.at(ref), subsongs[ref]),

	identify: async (ref: number, _row: TrackColumns, columns: string[] = []) => {
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

	fill: fillByLibrary(paths, subsongs),
	queueTargets: queueViaHolding(paths, subsongs),

	addTo: (targetId: string, refs: Refs) =>
		addFromLibrary(targetId, { items: itemsFor(paths, subsongs, refs) }),

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
});

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
