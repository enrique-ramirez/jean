import { DiscAlbum } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import type { TrackColumns } from "@/shared/api/types";
import { useTranslate } from "@/shared/i18n/useTranslate";
import { Artwork } from "@/shared/ui/Artwork";
import { coverIdentity } from "./fields";
import type { LibrarySource } from "./librarySource";
import styles from "./Mosaic.module.css";
import { type Refs, refAt } from "./project";

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

interface Tile {
	ref: number;
	identity: string | undefined;
}

function albumTiles(rows: TrackColumns[], indices: Refs | null): Tile[] {
	const seen = new Set<string>();
	const tiles: Tile[] = [];

	for (let at = 0; at < rows.length; at += 1) {
		const identity = coverIdentity(rows[at]);
		const key = identity ?? `#${at}`;
		if (seen.has(key)) continue;

		seen.add(key);
		tiles.push({ ref: refAt(indices, at), identity });
	}

	return tiles;
}

export function Mosaic({
	source,
	rows,
	indices = null,
	seed = null,
	size = 176,
}: {
	source: LibrarySource;
	rows: TrackColumns[];
	indices?: Refs | null;
	seed?: string | null;
	size?: number | string;
}) {
	const t = useTranslate();
	const albums = useMemo(() => albumTiles(rows, indices), [rows, indices]);
	const tiles = tileCountFor(albums.length);

	const positions = useMemo(
		() =>
			pickPositions(seed, albums.length, tiles).map(
				(position) => albums[position],
			),
		[seed, albums, tiles],
	);

	const [answered, setAnswered] = useState(0);
	const settled = useCallback(() => setAnswered((count) => count + 1), []);
	const isReady = tiles > 0 && answered >= tiles;

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
