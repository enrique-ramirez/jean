import { useCallback, useEffect, useMemo, useReducer, useState } from "react";

import { advance, finished, workWhenIdle } from "@/shared/lib/idle";
import type { ArtworkOutcome } from "@/shared/ui/artworkQueue";
import { type AlbumTiles, tileKeys, tileSteps, tilesHeld } from "./albumTiles";
import { coverIdentity } from "./fields";
import { coverCandidates, coverTrackOf } from "./grouping";
import type { LibrarySource } from "./librarySource";
import type { TileRow } from "./libraryWindows";
import { EMPTY_VIEW, type TrackRows } from "./project";
import { runStartsOf } from "./runsIndex";
import { useLibraryWindows } from "./useLibraryWindows";
import { usePlaylistState, usePlaylistWindows } from "./usePlaylistItems";

const tileCountFor = (albums: number) =>
	albums === 0 ? 0 : albums >= 9 ? 9 : albums >= 4 ? 4 : 1;

const hash = (text: string) => {
	let accumulated = 0;
	for (let index = 0; index < text.length; index += 1) {
		accumulated = (accumulated * 31 + text.charCodeAt(index)) >>> 0;
	}
	return accumulated;
};

const pickPositions = (seed: string | null, count: number, tiles: number) => {
	if (tiles === 0) return [];
	const stride = count / tiles;
	const offset = hash(seed ?? "") % Math.max(1, Math.floor(stride));
	return Array.from({ length: tiles }, (_, tile) =>
		Math.min(count - 1, Math.floor(tile * stride) + offset),
	);
};

const IMMEDIATE_ROWS = 20_000;

function useAlbumTiles(rows: TrackRows): AlbumTiles | null {
	const [, built] = useReducer((count: number) => count + 1, 0);
	const held =
		tilesHeld.peek(tileKeys(rows)) ??
		(rows.length <= IMMEDIATE_ROWS ? finished(tileSteps(rows)) : undefined);

	useEffect(() => {
		if (held !== undefined) return;
		const steps = tileSteps(rows);
		return workWhenIdle((hasTime) => {
			const done = advance(steps, hasTime);
			if (done.isDone) built();
			return done.isDone;
		});
	}, [rows, held]);

	return held ?? null;
}

export interface CoverPicks {
	albumCount: number | null;
	tiles: 0 | 1 | 4 | 9;
	picks: { ref: number; identity: string | undefined; src?: string | null }[];
	settled: (outcome?: ArtworkOutcome) => void;
	isReady: boolean;
	hasCover: boolean;
}

type Pick = CoverPicks["picks"][number];

interface Chosen {
	albumCount: number | null;
	tiles: CoverPicks["tiles"];
	chosen: Pick[];
}

function useTilesFromRows(rows: TrackRows, seed: string | null): Chosen {
	const held = useAlbumTiles(rows);
	const tiles = tileCountFor(held?.tiles.length ?? 0) as CoverPicks["tiles"];

	const chosen = useMemo(
		() =>
			held === null
				? []
				: pickPositions(seed, held.tiles.length, tiles).map((position) => {
						const at = held.tiles[position];
						return {
							ref: rows.ref(at),
							identity: coverIdentity(rows.at(at)),
						};
					}),
		[seed, held, tiles, rows],
	);

	return { albumCount: held?.albumGroups ?? null, tiles, chosen };
}

const NO_PICKS: Pick[] = [];
const NO_ORDINALS: number[] = [];

function useTilesFromRuns(rows: TrackRows | null, seed: string | null): Chosen {
	const hasRows = rows !== null;
	const { windowed, state } = useLibraryWindows(hasRows);
	const held = state.runs;
	const positions = rows?.indices ?? null;

	const candidates = useMemo(
		() => (held && hasRows ? coverCandidates(held.runs, positions) : null),
		[held, hasRows, positions],
	);
	const tiles = tileCountFor(candidates?.count ?? 0) as CoverPicks["tiles"];

	const ordinals = useMemo(
		() =>
			held && candidates
				? pickPositions(seed, candidates.count, tiles).map((pick) => {
						const position = candidates.at(pick);
						return coverTrackOf(
							held.runs,
							positions ? positions[position] : position,
						);
					})
				: NO_ORDINALS,
		[seed, held, candidates, tiles, positions],
	);

	const structure = state.list?.structure ?? null;
	const afterViewport = rows?.viewport !== undefined;
	const [landed, setLanded] = useState<{
		ordinals: number[];
		rows: TileRow[];
	} | null>(null);

	useEffect(() => {
		if (!windowed || structure === null || ordinals.length === 0)
			return undefined;
		const reading = new AbortController();
		windowed
			.readTileRows(structure, ordinals, afterViewport, reading.signal)
			.then((read) => {
				if (read && !reading.signal.aborted)
					setLanded({ ordinals, rows: read });
			});
		return () => reading.abort();
	}, [windowed, structure, ordinals, afterViewport]);

	const chosen = useMemo(
		() =>
			landed?.ordinals === ordinals
				? landed.rows.map((row, at) => ({
						ref: ordinals[at],
						identity: coverIdentity(row.columns),
						src: row.artworkUrl,
					}))
				: NO_PICKS,
		[landed, ordinals],
	);

	return { albumCount: null, tiles, chosen };
}

// foo_jean reads a playlist's rows by offset and count only, so its mosaic is picked once from the
// run starts the view already holds, and read from nowhere.
function useTilesFromHeldRuns(
	source: LibrarySource | null,
	rows: TrackRows,
	seed: string | null,
): Chosen {
	const id = source?.playlistId ?? null;
	const state = usePlaylistState(usePlaylistWindows(id));
	const [kept, setKept] = useState<{ key: string } & Chosen>();

	const key = id && state.runs ? `${id}\n${state.runs.structure}` : null;

	if (source && key && state.runs && kept?.key !== key) {
		const held: number[] = [];
		for (const start of runStartsOf(state.runs.runs.lengths))
			if (!rows.isPending(start)) held.push(start);
		if (held.length > 0) {
			const tiles = tileCountFor(held.length) as CoverPicks["tiles"];
			const chosen = pickPositions(seed, held.length, tiles).map((pick) => {
				const ref = held[pick];
				return {
					ref,
					identity: coverIdentity(rows.at(ref)),
					src: source.artworkUrl(ref),
				};
			});
			setKept({ key, albumCount: null, tiles, chosen });
		}
	}

	return key !== null && kept?.key === key
		? kept
		: { albumCount: null, tiles: 0, chosen: NO_PICKS };
}

export function useCoverPicks(
	source: LibrarySource,
	rows: TrackRows,
	seed: string | null,
): CoverPicks {
	const isLibrary = source.kind === "library";
	const isHeldPlaylist = source.kind === "playlist" && !!rows.viewport;
	const fromRows = useTilesFromRows(rows.viewport ? EMPTY_VIEW : rows, seed);
	const fromRuns = useTilesFromRuns(isLibrary ? rows : null, seed);
	const fromHeld = useTilesFromHeldRuns(
		isHeldPlaylist ? source : null,
		rows,
		seed,
	);
	const { tiles, chosen } = isLibrary
		? fromRuns
		: isHeldPlaylist
			? fromHeld
			: fromRows;
	const { albumCount } = fromRows;

	const [kept, setKept] = useState(chosen);
	const isSame =
		kept.length === chosen.length &&
		chosen.every(
			(pick, at) =>
				pick.ref === kept[at].ref && pick.identity === kept[at].identity,
		);
	if (!isSame) setKept(chosen);
	const picks = isSame ? kept : chosen;

	const [answers, setAnswers] = useState({ picks, answered: 0, loaded: 0 });
	const settled = useCallback(
		(outcome?: ArtworkOutcome) =>
			setAnswers((current) => {
				const base =
					current.picks === picks ? current : { picks, answered: 0, loaded: 0 };
				return {
					picks,
					answered: base.answered + 1,
					loaded: outcome === "ok" ? base.loaded + 1 : base.loaded,
				};
			}),
		[picks],
	);
	const counted =
		answers.picks === picks ? answers : { answered: 0, loaded: 0 };

	return {
		albumCount,
		tiles,
		picks,
		settled,
		isReady: tiles > 0 && counted.answered >= tiles,
		hasCover: counted.loaded > 0,
	};
}
