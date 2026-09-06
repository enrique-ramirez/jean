import { DiscAlbum } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import type { TrackColumns } from "@/shared/api/types";
import { plural } from "@/shared/lib/text";
import { Artwork } from "@/shared/ui/Artwork";
import { FIELD, tagKey, value } from "./fields";
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

function albumRefs(rows: TrackColumns[], indices: Refs | null): number[] {
	const seen = new Set<string>();
	const refs: number[] = [];

	for (let at = 0; at < rows.length; at += 1) {
		const row = rows[at];
		const album = value(row, FIELD.album);
		const artist =
			value(row, FIELD.albumArtist) ?? value(row, FIELD.artist) ?? "";
		const key = album ? `${tagKey(artist)}\u0000${tagKey(album)}` : `#${at}`;
		if (seen.has(key)) continue;

		seen.add(key);
		refs.push(refAt(indices, at));
	}

	return refs;
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
	const albums = useMemo(() => albumRefs(rows, indices), [rows, indices]);
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
			{positions.map((index, position) => (
				<Artwork
					// biome-ignore lint/suspicious/noArrayIndexKey: a fixed grid of tiles, never reordered, so the slot is the identity
					key={`${index}-${position}`}
					src={source.artworkUrl(index)}
					size="100%"
					className={styles.tile}
					onSettled={settled}
				/>
			))}

			{isReady && albums.length !== tiles ? (
				<span className={styles.count}>{plural(albums.length, "album")}</span>
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
