import {
	addFromLibrary,
	artworkUrl,
	copyPlaylistItems,
	fetchLibraryItems,
	fetchPlaylistItems,
	fetchPlaylists,
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
import type { Refs } from "./project";

// One interface over the two places tracks come from: the media library API and a playlist.
// A row is addressed by a numeric ref, so the virtualised list, the selection and the search index never learn which source they are looking at.
export interface ResolvedTrack {
	identity: TrackIdentity;
	columns: string[];
}

export interface QueueTarget {
	playlistId: string;
	itemIndex: number;
}

export interface LibrarySource {
	kind: "library" | "playlist";
	// Null on the media library; anything that needs a playlist to act goes through the methods rather than reaching for this.
	playlistId: string | null;
	// Whether `fill` needs the target's live item count: emptying a playlist is a remove-by-range, and a cached count is stale from the first write on.
	needsHeldCount: boolean;

	artworkUrl: (ref: number) => string;
	// Resolves a ref to an absolute path, which neither source holds; `columns` are evaluated on the same round trip.
	// Null when the ref no longer names the row it was read from: indices move, and the failure mode is writing a tag to somebody else's file.
	identify: (
		ref: number,
		row: TrackColumns,
		columns?: string[],
	) => Promise<ResolvedTrack | null>;
	fill: (targetId: string, refs: Refs, heldCount?: number) => Promise<unknown>;
	addTo: (targetId: string, refs: Refs) => Promise<unknown>;
	// `holding` is called only by a source that needs somewhere to put the tracks first. Pairs come back in the order asked for.
	queueTargets: (
		refs: Refs,
		holding: () => Promise<string | null>,
	) => Promise<QueueTarget[]>;
	playingPosition: (
		refs: Refs,
		track: TrackIdentity | null | undefined,
		activeItem?: PlaybackPosition | null,
	) => number;
}

export type LibrarySourceOptions =
	| { kind: "library"; paths: string[]; subsongs: number[] }
	| { kind: "playlist"; playlistId: string };

interface ItemChunk {
	items: { path: string; subsong: number }[];
	bytes: number;
}

// Array.from, never refs.map: refs can be an Int32Array, and mapping one gives back a typed array whose objects coerce to NaN.
const itemsFor = (paths: string[], subsongs: number[], refs: Refs) =>
	Array.from(refs, (ref) => ({ path: paths[ref], subsong: subsongs[ref] }));

// The player files a set in the media library's browse order rather than the order it was sent, so a view that plays by position would play the wrong track. The order cannot be predicted, so it is overwritten.
const sortToLibraryOrder = (targetId: string) =>
	sortPlaylistItems(targetId, LIBRARY_SORT);

// beefweb hangs up over 1 MiB, and it arrives as a network error rather than a status.
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
	(paths: string[], subsongs: number[]) =>
	async (targetId: string, refs: Refs) => {
		// Omitting `items` means the whole library, in one request with no body and no per-track path resolution.
		if (refs.length === paths.length) {
			await addFromLibrary(targetId, { replace: true });
			return sortToLibraryOrder(targetId);
		}

		// Sequential, and it has to be: only the first request may replace, and run concurrently that replace could arrive last and empty what it filled.
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

// The read-back is not caution: the player files a set in the library's browse order rather than the order it was sent. The appended block is contiguous.
const queueViaHolding =
	(paths: string[], subsongs: number[]) =>
	async (refs: Refs, holding: () => Promise<string | null>) => {
		const playlistId = await holding();
		if (!playlistId || refs.length === 0) return [];

		// From the player, not the cache: item changes are never pushed, so a cached count is stale from the first write on.
		const before =
			(await fetchPlaylists()).find((entry) => entry.id === playlistId)
				?.itemCount ?? 0;

		await addFromLibrary(playlistId, {
			items: itemsFor(paths, subsongs, refs),
		});

		const landed = await fetchPlaylistItems(playlistId, before, refs.length, [
			"%path%",
		]);
		// The playlist answers with an absolute, platform-separated path and the library with a relative, forward-slashed one, so they only meet by suffix.
		const matchers = landed.rows.map((row) => libraryPathMatcher(row[0]));

		return Array.from(refs, (ref) => {
			const at = matchers.findIndex((matches) => matches(paths[ref]));
			return at < 0 ? null : { playlistId, itemIndex: before + at };
		}).filter((target): target is QueueTarget => target !== null);
	};

const fromMediaLibrary = ({
	paths,
	subsongs,
}: {
	paths: string[];
	subsongs: number[];
}): LibrarySource => ({
	kind: "library",
	playlistId: null,
	needsHeldCount: false,

	artworkUrl: (ref: number) => libraryArtworkUrl(paths[ref], subsongs[ref]),

	// Checked against the relative path already held: the item's `path` field is relative, while the `%path%` column is the player's absolute rendering.
	identify: async (ref: number, _row: TrackColumns, columns: string[] = []) => {
		const held = paths[ref];
		if (!held) return null;

		const { items } = await fetchLibraryItems({
			columns: ["%path%", ...columns],
			offset: ref,
			count: 1,
		});
		const item = items[0];
		if (!item || item.path !== held) return null;

		return {
			identity: { path: item.columns[0] || null, subsong: subsongs[ref] ?? 0 },
			columns: item.columns.slice(1),
		};
	},

	fill: fillByLibrary(paths, subsongs),
	queueTargets: queueViaHolding(paths, subsongs),

	// No sort here, unlike `fill`: that playlist is the user's and its order is theirs.
	addTo: (targetId: string, refs: Refs) =>
		addFromLibrary(targetId, { items: itemsFor(paths, subsongs, refs) }),

	// Linear, where the playlist source bisects, because path order is not ref order.
	playingPosition: (refs: Refs, track: TrackIdentity | null | undefined) => {
		if (!track?.path) return -1;
		const matches = libraryPathMatcher(track.path);
		const subsong = track.subsong ?? 0;
		return Array.prototype.findIndex.call(
			refs,
			(ref: number) => subsongs[ref] === subsong && matches(paths[ref]),
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

	// Only the title to check against here. Weak, since two tracks can share one, but it catches the desktop inserting rows above and shifting every index.
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

	// A ref already is a position here, so nothing is created or read back.
	queueTargets: async (refs: Refs) =>
		Array.from(refs, (ref) => ({ playlistId, itemIndex: ref })),
	addTo: (targetId: string, refs: Refs) =>
		copyPlaylistItems(playlistId, targetId, refs),

	// Index is identity in a playlist, so this can only answer while the player is inside the playlist being browsed. Refs arrive ascending, so it bisects.
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
