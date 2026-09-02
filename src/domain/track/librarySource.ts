import {
	addFromLibrary,
	artworkUrl,
	copyPlaylistItems,
	fetchPlaylistItems,
	fetchPlaylists,
	LIBRARY_SORT,
	libraryArtworkUrl,
	libraryPathMatcher,
	removePlaylistItems,
	sortPlaylistItems,
} from "@/shared/api/beefweb";
import type { PlaybackPosition, TrackIdentity } from "@/shared/api/types";
import { positionOf } from "./libraryIndex";
import type { Refs } from "./project";

// Two answers to "where does the library come from" -- the media library API,
// and an autoplaylist -- behind one interface.
//
// The seam is a numeric ref per row, so the virtualised list, the selection and
// the search index stay integer-keyed and never learn which source they are
// looking at. If something outside this file has to ask, the seam is in the
// wrong place.

// What `/playqueue/add` needs, and what a media library row cannot supply on its
// own -- it is in no playlist at all.
export interface QueueTarget {
	playlistId: string;
	itemIndex: number;
}

export interface LibrarySource {
	kind: "library" | "playlist";
	// Null on the media library. Anything that needs a playlist to act goes
	// through the methods rather than reaching for this.
	playlistId: string | null;
	// Whether `fill` needs the target's live item count: emptying a playlist is
	// a remove-by-range, and a cached count is stale from the first write on.
	needsHeldCount: boolean;

	artworkUrl: (ref: number) => string;
	fill: (targetId: string, refs: Refs, heldCount?: number) => Promise<unknown>;
	addTo: (targetId: string, refs: Refs) => Promise<unknown>;
	// `holding` is called only by a source that needs somewhere to put the tracks
	// first. Pairs come back in the order asked for.
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

// Array.from, never refs.map: refs arrive as an Int32Array, and mapping a typed
// array gives back a typed array -- the objects coerce to NaN and the body
// serialises as `{"0":0,...}` rather than a list.
const itemsFor = (paths: string[], subsongs: number[], refs: Refs) =>
	Array.from(refs, (ref) => ({ path: paths[ref], subsong: subsongs[ref] }));

// The player adds a set in the media library's browse order, not the path order
// the rows are in, so every view that plays by position would play the wrong
// track. The order cannot be predicted and there is no library-change event to
// cache it against, so it is overwritten rather than learned.
const sortToLibraryOrder = (targetId: string) =>
	sortPlaylistItems(targetId, LIBRARY_SORT);

// beefweb hangs up over 1 MiB, and it arrives as a network error rather than a
// status -- so naming a whole library never reached the player at all.
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
		// Omitting `items` means the whole library, in one request with no body and
		// no per-track path resolution. The sort below makes the two
		// indistinguishable afterwards.
		if (refs.length === paths.length) {
			await addFromLibrary(targetId, { replace: true });
			return sortToLibraryOrder(targetId);
		}

		// Sequential, and it has to be: only the first may replace. Run
		// concurrently, that replace could arrive last and empty what it filled.
		await chunkedItems(itemsFor(paths, subsongs, refs)).reduce<
			Promise<unknown>
		>(
			(done, chunk, at) =>
				done.then(() =>
					addFromLibrary(targetId, { items: chunk.items, replace: at === 0 }),
				),
			Promise.resolve(),
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

// The read-back is not caution: the player files a set in the media library's
// browse order, not the order it was sent, and a queue in the wrong order is the
// one bug a queue cannot have. The appended block is contiguous.
const queueViaHolding =
	(paths: string[], subsongs: number[]) =>
	async (refs: Refs, holding: () => Promise<string | null>) => {
		const playlistId = await holding();
		if (!playlistId || refs.length === 0) return [];

		// Off the player: item changes are never pushed, so a cached count is stale
		// from the first write on, and this one decides which rows get read back.
		const before =
			(await fetchPlaylists()).find((entry) => entry.id === playlistId)
				?.itemCount ?? 0;

		await addFromLibrary(playlistId, {
			items: itemsFor(paths, subsongs, refs),
		});

		const landed = await fetchPlaylistItems(playlistId, before, refs.length, [
			"%path%",
		]);
		// The playlist answers with an absolute, platform-separated path and the
		// library with a relative, forward-slashed one, so they only meet by suffix.
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
	fill: fillByLibrary(paths, subsongs),
	queueTargets: queueViaHolding(paths, subsongs),

	// No sort here, unlike `fill`: that playlist is the user's and its order is
	// theirs.
	addTo: (targetId: string, refs: Refs) =>
		addFromLibrary(targetId, { items: itemsFor(paths, subsongs, refs) }),

	// Linear, where the playlist source bisects, because path order is not ref
	// order. Paid once per track change rather than per player message.
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
	fill: fillByCopy(playlistId),

	// A ref already *is* a position here, so nothing is created or read back.
	queueTargets: async (refs: Refs) =>
		Array.from(refs, (ref) => ({ playlistId, itemIndex: ref })),
	addTo: (targetId: string, refs: Refs) =>
		copyPlaylistItems(playlistId, targetId, refs),

	// Index is identity here, so this can only answer while the player is inside
	// the playlist being browsed -- the limitation the library source does not
	// have. Refs arrive ascending, so it bisects.
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
