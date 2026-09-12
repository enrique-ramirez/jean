import type { QueueTarget } from "@/domain/player/queue";
import {
	addFromLibrary,
	artworkUrl,
	copyPlaylistItems,
	fetchLibraryNodes,
	fetchPlaylistItems,
	libraryPathMatcher,
	removePlaylistItems,
} from "@/shared/api/beefweb";
import { bearer, encodeFill, libraryArtworkUrl } from "@/shared/api/fooJean";
import type { components } from "@/shared/api/fooJeanSchema";
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

type FillOwnPlaylistRequest = components["schemas"]["FillOwnPlaylistRequest"];
type FillResult = components["schemas"]["FillResult"];

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
	  }
	| { kind: "playlist"; playlistId: string };

// Array.from, never refs.map: refs can be an Int32Array, and mapping one gives back a typed array
// whose objects coerce to NaN.
const itemsFor = (paths: PathTable, subsongs: Int32Array, refs: Refs) =>
	Array.from(refs, (ref) => ({ path: paths.at(ref), subsong: subsongs[ref] }));

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

		const response = await fetch(`${origin}/api/playlists/own/scratch/items`, {
			method: "POST",
			headers: { ...bearer(token), "Content-Type": "application/json" },
			body: JSON.stringify(request),
		});
		if (!response.ok)
			throw new Error(
				`POST /playlists/own/scratch/items failed: ${response.status}`,
			);

		const result = (await response.json()) as FillResult;
		return result.beefwebId;
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
	artworkOrigin,
}: {
	paths: PathTable;
	subsongs: Int32Array;
	artworkOrigin: string | null;
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
