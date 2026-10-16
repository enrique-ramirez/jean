import { DiscAlbum } from "lucide-react";
import { useCallback, useEffect, useMemo, useReducer, useState } from "react";

import { useTranslate } from "@/shared/i18n/useTranslate";
import { advance, finished, workWhenIdle } from "@/shared/lib/idle";
import { Artwork } from "@/shared/ui/Artwork";
import { tileKeys, tileSteps, tilesHeld } from "./albumTiles";
import { coverIdentity } from "./fields";
import type { LibrarySource } from "./librarySource";
import styles from "./Mosaic.module.css";
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

function useAlbumTiles(rows: TrackRows): number[] | null {
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

export function Mosaic({
	source,
	rows,
	seed = null,
	size = 176,
}: {
	source: LibrarySource;
	rows: TrackRows;
	seed?: string | null;
	size?: number | string;
}) {
	const t = useTranslate();
	const albums = useAlbumTiles(rows);
	const tiles = tileCountFor(albums?.length ?? 0);

	const positions = useMemo(
		() =>
			albums === null
				? []
				: pickPositions(seed, albums.length, tiles).map((position) => {
						const at = albums[position];
						return {
							ref: rows.ref(at),
							identity: coverIdentity(rows.at(at)),
						};
					}),
		[seed, albums, tiles, rows],
	);

	const [answered, setAnswered] = useState(0);
	const settled = useCallback(() => setAnswered((count) => count + 1), []);
	const isReady = tiles > 0 && answered >= tiles;

	if (albums === null) {
		return (
			<div className={styles.mosaic} style={{ width: size, height: size }}>
				<span
					className={`${styles.hold} loading`}
					data-mosaic-hold=""
					aria-hidden="true"
				>
					<DiscAlbum strokeWidth={1.5} />
				</span>
			</div>
		);
	}

	if (tiles === 0) {
		return (
			<div
				className={`${styles.mosaic} ${styles.empty}`}
				style={{ width: size, height: size }}
			>
				<DiscAlbum size={32} strokeWidth={1.5} aria-hidden="true" />
			</div>
		);
	}

	return (
		<div
			className={styles.mosaic}
			data-tiles={tiles}
			data-ready={isReady ? "true" : undefined}
			style={{ width: size, height: size }}
		>
			{positions.map((tile, position) => (
				<Artwork
					// biome-ignore lint/suspicious/noArrayIndexKey: a fixed grid of tiles, never reordered, so the slot is the identity
					key={`${tile.ref}-${position}`}
					src={source.artworkUrl(tile.ref)}
					identity={tile.identity}
					size="100%"
					className={styles.tile}
					onSettled={settled}
				/>
			))}

			{isReady && albums.length !== tiles ? (
				<span className={styles.count}>
					{t("artist.albumCount", {
						count: albums.length,
						total: albums.length,
					})}
				</span>
			) : null}

			{isReady ? null : (
				<span
					className={`${styles.hold} loading`}
					data-mosaic-hold=""
					aria-hidden="true"
				>
					<DiscAlbum strokeWidth={1.5} />
				</span>
			)}
		</div>
	);
}
