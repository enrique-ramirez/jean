import type { QueueSource } from "@/domain/player/queue";
import {
	coverPathOf,
	libraryArtworkUrl,
	playlistRowArtworkUrl,
} from "@/shared/api/artwork";
import { orThrow } from "@/shared/api/client";
import { requireFooJean } from "@/shared/api/discovery";
import { encodeFill, runsOf } from "@/shared/api/fillEncoding";
import {
	copyPlaylistRows,
	type Duplicates,
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
import { announcedLibraryOf } from "./libraryHolds";
import type { PathTable } from "./pathTable";
import { componentLibraryKey, playlistSnapshot } from "./playlistEntries";
import type { Refs } from "./project";
import {
	isAnswered,
	type LibraryList,
	type PlaylistList,
	type RowWindows,
	trackPathAt,
} from "./rowWindows";

export interface AddedRows {
	positions: number[];
	structure: string;
	skipped: number[];
}

export interface LibrarySourceCommon {
	playlistId: string | null;

	artworkUrl: (ref: number) => string | null;

	addresses: (ref: number) => TrackAddress[];
	address: (ref: number) => TrackAddress | null;
	addTo: (
		targetId: string,
		refs: Refs,
		duplicates: Duplicates,
	) => Promise<AddedRows>;
	queueTargets: (refs: Refs) => Promise<QueueSource>;
	playingPosition: (
		refs: Refs | null,
		track: TrackIdentity | null | undefined,
		activeItem?: PlaybackPosition | null,
	) => number;
}

export type LibrarySource =
	| (LibrarySourceCommon & {
			kind: "library";
			// The component resolves and titles the scratch playlist in the same call that fills it.
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
	structure?: string | null;
};

export type LibrarySourceOptions =
	| ({ kind: "library" } & MediaLibraryOptions)
	| ({ kind: "playlist" } & PlaylistOptions);

interface LibraryFigures {
	structure: number;
	trackCount: number;
}

const fillScratch =
	(figures: () => LibraryFigures, origin: string | null) =>
	async (title: string, refs: Refs): Promise<Filled | null> => {
		if (!origin) return null;

		const request: FillOwnPlaylistRequest = {
			title,
			...encodeFill(refs, figures()),
		};

		const result = orThrow(await fillOwnPlaylist(origin, "scratch", request));
		return { id: result.playlistId, structure: result.structure };
	};

const addToPlaylist =
	(figures: () => LibraryFigures, origin: string | null) =>
	async (
		targetId: string,
		refs: Refs,
		duplicates: Duplicates,
	): Promise<AddedRows> => {
		const required = requireFooJean(origin);

		const request: FillPlaylistRequest = {
			...encodeFill(refs, figures()),
			duplicates,
		};

		const {
			positions,
			structure: landed,
			skipped,
		} = orThrow(await fillPlaylist(required, targetId, request));
		return { positions, structure: landed, skipped };
	};

const queueLibraryTracks =
	(figures: () => LibraryFigures) =>
	async (refs: Refs): Promise<QueueSource> => ({
		kind: "tracks",
		request: encodeFill(refs, figures()),
	});

export const libraryAddressesResolve = (origin: string | null) =>
	origin !== null && announcedLibraryOf(origin)?.ready === true;

export function positionOf(
	indices: Refs,
	index: number | null | undefined,
): number {
	if (index == null || index < 0) return -1;

	const bisect = (low: number, high: number): number => {
		if (low > high) return -1;
		const middle = (low + high) >> 1;
		if (indices[middle] === index) return middle;
		return indices[middle] < index
			? bisect(middle + 1, high)
			: bisect(low, middle - 1);
	};

	return bisect(0, indices.length - 1);
}

const placeOfOrdinal = (
	refs: Refs | null,
	ordinal: number | null | undefined,
) => (ordinal == null ? -1 : refs === null ? ordinal : refs.indexOf(ordinal));

const fromMediaLibrary = ({
	paths,
	subsongs,
	artworkOrigin,
}: MediaLibraryOptions): Extract<LibrarySource, { kind: "library" }> => {
	const snapshot = artworkOrigin
		? playlistSnapshot(componentLibraryKey(artworkOrigin))
		: null;
	const structure = snapshot ? snapshot.structure : 0;
	const figures = () => ({ structure, trackCount: paths.length });

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
			libraryArtworkUrl(artworkOrigin, paths.at(ref)),

		addresses,
		address: (ref: number) => addresses(ref)[0] ?? null,

		fill: fillScratch(figures, artworkOrigin),
		queueTargets: queueLibraryTracks(figures),

		addTo: addToPlaylist(figures, artworkOrigin),

		playingPosition: (refs, track) =>
			placeOfOrdinal(refs, track?.libraryOrdinal),
	};
};

export interface WindowedLibraryOptions {
	windows: RowWindows;
	origin: string;
	listNow: () => LibraryList | null;
	coverOf: (ordinal: number) => number | null;
}

export const windowedSourceOf = ({
	windows,
	origin,
	listNow,
	coverOf,
}: WindowedLibraryOptions): Extract<LibrarySource, { kind: "library" }> => {
	const figures = () => {
		const list = listNow();
		return { structure: list?.structure ?? 0, trackCount: list?.length ?? 0 };
	};

	const heldRow = (ordinal: number) => {
		const list = listNow();
		const held = list ? windows.at(list, ordinal) : null;
		return held?.kind === "library" ? held : null;
	};

	const pathOf = (ordinal: number) => {
		const held = heldRow(ordinal);
		return held ? trackPathAt(held.window, held.row) : null;
	};

	const addresses = (ordinal: number): TrackAddress[] => {
		const list = listNow();
		const held = heldRow(ordinal);
		const track = pathOf(ordinal);
		if (!list || !held || !track) return [];

		return [
			{
				kind: "library",
				track,
				subsong: Number(held.window.spine.subsong.at(held.row)) || 0,
			},
			{ kind: "ordinal", ordinal, structure: list.structure },
		];
	};

	return {
		kind: "library",
		playlistId: null,

		artworkUrl: (ordinal) => {
			const cover = coverOf(ordinal);
			if (cover === null) return null;
			const track = pathOf(cover) ?? pathOf(ordinal);
			return track === null ? null : libraryArtworkUrl(origin, track);
		},

		addresses,
		address: (ordinal) => addresses(ordinal)[0] ?? null,

		fill: fillScratch(figures, origin),
		queueTargets: queueLibraryTracks(figures),
		addTo: addToPlaylist(figures, origin),

		playingPosition: (refs, track) =>
			placeOfOrdinal(refs, track?.libraryOrdinal),
	};
};

const queuePlaylistRows = async (
	playlistId: string,
	refs: Refs,
): Promise<QueueSource> => ({
	kind: "rows",
	targets: Array.from(refs, (ref) => ({ playlistId, itemIndex: ref })),
});

const copyPlaylistRowsTo = async (
	origin: string | null,
	playlistId: string,
	targetId: string,
	refs: Refs,
	duplicates: Duplicates,
): Promise<AddedRows> => {
	const required = requireFooJean(origin);
	return orThrow(
		await copyPlaylistRows(required, targetId, {
			source: playlistId,
			runs: runsOf(refs),
			duplicates,
		}),
	);
};

export interface WindowedPlaylistOptions {
	windows: RowWindows;
	origin: string;
	listNow: () => PlaylistList | null;
	id?: string;
}

export const windowedPlaylistSourceOf = ({
	windows,
	origin,
	listNow,
	id,
}: WindowedPlaylistOptions): Extract<LibrarySource, { kind: "playlist" }> => {
	const heldItem = (position: number) => {
		const list = listNow();
		const held = list ? windows.at(list, position) : null;
		return held?.kind === "playlist" ? held.page.items[held.row] : null;
	};

	const addresses = (position: number): TrackAddress[] => {
		const list = listNow();
		if (!list) return [];

		const forms: TrackAddress[] = [];
		const item = heldItem(position);
		if (item?.libraryPath)
			forms.push({
				kind: "library",
				track: item.libraryPath,
				subsong: item.subsong,
			});
		if (isAnswered(list.structure))
			forms.push({
				kind: "playlist",
				playlist: list.id,
				index: position,
				structure: list.structure,
			});
		return forms;
	};

	const idNow = () => {
		const named = id ?? listNow()?.id;
		if (!named) throw new Error("no playlist is on screen");
		return named;
	};

	return {
		kind: "playlist",
		get playlistId() {
			return id ?? listNow()?.id ?? null;
		},

		artworkUrl: (position) => {
			const list = listNow();
			const item = heldItem(position);
			if (!list || !item) return null;
			const path = coverPathOf(item);
			return path
				? libraryArtworkUrl(origin, path)
				: playlistRowArtworkUrl(origin, list.id, position);
		},

		addresses,
		address: (position) => addresses(position)[0] ?? null,

		queueTargets: (positions) => queuePlaylistRows(idNow(), positions),
		addTo: (targetId, positions, duplicates) =>
			copyPlaylistRowsTo(origin, idNow(), targetId, positions, duplicates),

		playingPosition: (refs, _track, activeItem) =>
			activeItem && activeItem.playlistId === (id ?? listNow()?.id)
				? refs
					? positionOf(refs, activeItem.index)
					: activeItem.index
				: -1,
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
			if (path) return libraryArtworkUrl(origin, path);

			return origin ? playlistRowArtworkUrl(origin, playlistId, ref) : null;
		},

		addresses,
		address: (ref: number) => addresses(ref)[0] ?? null,

		queueTargets: (refs: Refs) => queuePlaylistRows(playlistId, refs),
		addTo: (targetId: string, refs: Refs, duplicates: Duplicates) =>
			copyPlaylistRowsTo(origin, playlistId, targetId, refs, duplicates),

		playingPosition: (
			refs: Refs | null,
			_track: TrackIdentity | null | undefined,
			activeItem?: PlaybackPosition | null,
		) =>
			refs && activeItem?.playlistId === playlistId
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
