import type { QueueSource } from "@/domain/player/queue";
import { libraryArtworkUrl, playlistRowArtworkUrl } from "@/shared/api/artwork";
import { orThrow } from "@/shared/api/client";
import { requireFooJean } from "@/shared/api/discovery";
import { encodeFill, runsOf } from "@/shared/api/fillEncoding";
import { libraryPathTails } from "@/shared/api/playerState";
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
import { overObjects } from "./columnCache";
import { albumCanonicalIndex, canonicalTrackRefs } from "./grouping";
import { positionOf } from "./libraryIndex";
import type { PathTable } from "./pathTable";
import {
	componentLibraryKey,
	type PlaylistSnapshot,
	playlistSnapshot,
} from "./playlistEntries";
import type { Refs } from "./project";

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
		refs: Refs,
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

const fillScratch =
	(paths: PathTable, origin: string | null, structure: number) =>
	async (title: string, refs: Refs): Promise<Filled | null> => {
		if (!origin) return null;

		const request: FillOwnPlaylistRequest = {
			title,
			...encodeFill(refs, { structure, trackCount: paths.length }),
		};

		const result = orThrow(await fillOwnPlaylist(origin, "scratch", request));
		return { id: result.playlistId, structure: result.structure };
	};

const addToPlaylist =
	(paths: PathTable, origin: string | null, structure: number) =>
	async (
		targetId: string,
		refs: Refs,
		duplicates: Duplicates,
	): Promise<AddedRows> => {
		const required = requireFooJean(origin);

		const request: FillPlaylistRequest = {
			...encodeFill(refs, { structure, trackCount: paths.length }),
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
	(paths: PathTable, structure: number) =>
	async (refs: Refs): Promise<QueueSource> => ({
		kind: "tracks",
		request: encodeFill(refs, { structure, trackCount: paths.length }),
	});

const canonicalPaths = overObjects<Map<string, string>>();

const canonicalPathOf = (snapshot: PlaylistSnapshot, path: string): string => {
	const paths = snapshot.paths;
	if (!paths) return path;

	const refs = canonicalTrackRefs(snapshot.columns);
	const keys = [refs, paths];
	let byPath = canonicalPaths.get(keys);
	if (!byPath) {
		byPath = new Map<string, string>();
		for (let ref = 0; ref < refs.length; ref += 1) {
			const own = paths.at(ref);
			const canonical = own ? paths.at(refs[ref]) : "";
			if (own && canonical) byPath.set(own, canonical);
		}
		canonicalPaths.set(keys, byPath);
	}

	return byPath.get(path) ?? path;
};

export const libraryAddressesResolve = (
	origin: string | null,
	exportHeldWhenLibraryUnbuilt: number | null,
) => {
	if (origin === null) return false;

	const { structure, paths } = playlistSnapshot(componentLibraryKey(origin));
	return paths !== null && structure !== exportHeldWhenLibraryUnbuilt;
};

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

export function canonicalPlayingArtworkUrl(
	origin: string | null,
	album: string,
	credited: string,
): string | null {
	if (!origin || !album) return null;

	const snapshot = playlistSnapshot(componentLibraryKey(origin));
	if (!snapshot.paths) return null;

	const ref = albumCanonicalIndex(snapshot.columns).refFor(album, credited);
	if (ref === null) return null;

	const canonical = snapshot.paths.at(ref);
	return canonical ? libraryArtworkUrl(origin, canonical) : null;
}

function playingPositionIn(paths: PathTable, subsongs: Int32Array) {
	let refsByPath: Map<string, number[]> | null = null;
	const placesByView = new WeakMap<Refs, Int32Array>();

	const refsOfPath = () => {
		if (refsByPath) return refsByPath;
		refsByPath = new Map();
		for (let ref = 0; ref < paths.length; ref += 1) {
			const path = paths.at(ref);
			if (!path) continue;
			const held = refsByPath.get(path);
			if (held) held.push(ref);
			else refsByPath.set(path, [ref]);
		}
		return refsByPath;
	};

	const placesIn = (refs: Refs) => {
		let places = placesByView.get(refs);
		if (!places) {
			places = new Int32Array(paths.length).fill(-1);
			for (let place = 0; place < refs.length; place += 1)
				if (places[refs[place]] === -1) places[refs[place]] = place;
			placesByView.set(refs, places);
		}
		return places;
	};

	return (refs: Refs, track: TrackIdentity | null | undefined) => {
		if (!track?.path || !paths || !subsongs) return -1;

		const subsong = track.subsong ?? 0;
		const places = placesIn(refs);
		const candidates = libraryPathTails(track.path);

		let first = -1;
		for (const candidate of candidates)
			for (const ref of refsOfPath().get(candidate) ?? []) {
				const place = places[ref];
				if (subsongs[ref] !== subsong || place < 0) continue;
				first = first < 0 ? place : Math.min(first, place);
			}
		return first;
	};
}

const fromMediaLibrary = ({
	paths,
	subsongs,
	artworkOrigin,
}: MediaLibraryOptions): Extract<LibrarySource, { kind: "library" }> => {
	const snapshot = artworkOrigin
		? playlistSnapshot(componentLibraryKey(artworkOrigin))
		: null;
	const structure = snapshot ? snapshot.structure : 0;
	const canonicalRefs = snapshot ? canonicalTrackRefs(snapshot.columns) : null;

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

		playingPosition: playingPositionIn(paths, subsongs),
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
		addTo: async (
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
		},

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
