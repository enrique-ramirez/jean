import { DiscAlbum } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { useTranslate } from "@/shared/i18n/useTranslate";
import { Artwork } from "@/shared/ui/Artwork";
import { artistGroups, coverIdentity, FIELD, tagGroups } from "./fields";
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

/**
 * One position per distinct cover, matching what `coverIdentity` groups by: the record where there
 * is an album tag, the track otherwise. Grouped by dictionary id rather than by the identity string,
 * which is then spelt out only for the few positions that are drawn.
 */
function albumTiles(rows: TrackRows): number[] {
	const { columns } = rows;
	const album = columns.fields[FIELD.album];
	const title = columns.fields[FIELD.title];

	const albums = tagGroups(album);
	const titles = tagGroups(title);
	const artists = artistGroups(columns);

	const seenAlbums = new Set<number>();
	const seenTracks = new Set<number>();
	const tiles: number[] = [];

	for (let at = 0; at < rows.length; at += 1) {
		const ref = rows.ref(at);

		const albumGroup = albums.of[album.ids[ref]];
		if (albumGroup >= 0) {
			const pair = artists.pairedWith(ref, albumGroup);
			if (seenAlbums.has(pair)) continue;
			seenAlbums.add(pair);
			tiles.push(at);
			continue;
		}

		const titleGroup = titles.of[title.ids[ref]];
		if (titleGroup >= 0) {
			const pair = artists.pairedWith(ref, titleGroup);
			if (seenTracks.has(pair)) continue;
			seenTracks.add(pair);
		}
		tiles.push(at);
	}

	return tiles;
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
	const albums = useMemo(() => albumTiles(rows), [rows]);
	const tiles = tileCountFor(albums.length);

	const positions = useMemo(
		() =>
			pickPositions(seed, albums.length, tiles).map((position) => {
				const at = albums[position];
				return { ref: rows.ref(at), identity: coverIdentity(rows.at(at)) };
			}),
		[seed, albums, tiles, rows],
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
