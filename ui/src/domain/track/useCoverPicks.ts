import { useCallback, useEffect, useMemo, useReducer, useState } from "react";

import { advance, finished, workWhenIdle } from "@/shared/lib/idle";
import type { ArtworkOutcome } from "@/shared/ui/artworkQueue";
import { type AlbumTiles, tileKeys, tileSteps, tilesHeld } from "./albumTiles";
import { coverIdentity } from "./fields";
import type { TrackRows } from "./project";

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
	picks: { ref: number; identity: string | undefined }[];
	settled: (outcome?: ArtworkOutcome) => void;
	isReady: boolean;
	hasCover: boolean;
}

export function useCoverPicks(
	rows: TrackRows,
	seed: string | null,
): CoverPicks {
	const held = useAlbumTiles(rows);
	const albumCount = held?.albumGroups ?? null;
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
