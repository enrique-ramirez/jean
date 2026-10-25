import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { coverKey, readValue } from "@/domain/track/fields";
import { LIBRARY_ROLES } from "@/domain/track/libraryAsker";
import {
	coverPathOf,
	libraryArtworkUrl,
	playlistRowArtworkUrl,
} from "@/shared/api/artwork";
import { orThrow } from "@/shared/api/client";
import { fetchPlaylistRows } from "@/shared/api/playlists";
import type { NeighbourArtwork } from "./CoverWheel";

interface RowWindowEntry {
	coverPath: string;
	identity: string | undefined;
}

type RowWindow = ReadonlyArray<
	readonly [position: number, row: RowWindowEntry]
>;

const NEIGHBOURS_KEY = "nowPlayingNeighbours";

async function fetchRowWindow(
	origin: string,
	playlistId: string,
	index: number,
): Promise<RowWindow> {
	const offset = Math.max(0, index - 1);
	const { items } = orThrow(
		await fetchPlaylistRows(
			origin,
			playlistId,
			offset,
			3,
			["%album%", "%album artist%", "%artist%", "%title%"],
			{ roles: LIBRARY_ROLES },
		),
	);
	return items.map((row, at) => {
		const [album, albumArtist, artist, title] = row.columns.map(readValue);
		const credited = albumArtist || artist;
		const identity = album
			? coverKey(credited, album)
			: title
				? coverKey(credited, title, "track")
				: undefined;
		return [
			offset + at,
			{ coverPath: coverPathOf(row) ?? "", identity },
		] as const;
	});
}

const artworkAt = (
	origin: string | null,
	playlistId: string | null,
	position: number,
	row: RowWindowEntry,
): NeighbourArtwork | null => {
	if (row.coverPath) {
		const src = libraryArtworkUrl(origin, row.coverPath);
		return src ? { src, identity: row.identity ?? src } : null;
	}

	if (!origin || !playlistId) return null;
	const src = playlistRowArtworkUrl(origin, playlistId, position);
	return src
		? { src, identity: row.identity ?? `pos:${playlistId}:${position}` }
		: null;
};

export function useCoverWindow({
	isOpen,
	origin,
	playlistId,
	index,
	isInOrder,
}: {
	isOpen: boolean;
	origin: string | null;
	playlistId: string | null | undefined;
	index: number | null;
	isInOrder: boolean;
}) {
	const position = index !== null && index >= 0 ? index : null;

	const windowQuery = useQuery({
		queryKey: [NEIGHBOURS_KEY, origin, playlistId, position],
		enabled: isOpen && position !== null && Boolean(origin && playlistId),
		queryFn: () =>
			origin && playlistId && position !== null
				? fetchRowWindow(origin, playlistId, position)
				: null,
		staleTime: Infinity,
		refetchOnWindowFocus: false,
		retry: false,
	}).data;

	// Every row a window has ever named, by position, so a row seen as a neighbour once is not
	// re-fetched the moment it becomes the centre. Kept only for the playlist it was read against:
	// a position means nothing once the playing playlist changes. A position absent from the map is
	// one this window has not read yet.
	const [knownRows, setKnownRows] = useState<Map<number, RowWindowEntry>>(
		() => new Map(),
	);
	const knownRowsPlaylist = useRef<string | null | undefined>(playlistId);
	// Cleared during render rather than in the effect below: the query for a new playlist answers
	// `undefined` until it lands, and waiting for that to clear the map would read a former
	// playlist's rows at the new one's positions for however long the fetch takes.
	if (knownRowsPlaylist.current !== playlistId) {
		knownRowsPlaylist.current = playlistId;
		setKnownRows(new Map());
	}
	useEffect(() => {
		if (!windowQuery) return;
		setKnownRows((current) => {
			const merged = new Map(current);
			let changed = false;
			for (const [position, row] of windowQuery) {
				const held = merged.get(position);
				if (
					!held ||
					held.coverPath !== row.coverPath ||
					held.identity !== row.identity
				) {
					merged.set(position, row);
					changed = true;
				}
			}
			return changed ? merged : current;
		});
	}, [windowQuery]);

	const rowAt = (position: number) => knownRows.get(position);

	// `undefined` is a neighbour this window has not read yet, and draws nothing rather than the
	// positional fallback: firing that now and the canonical address once the read lands would be
	// two requests for a neighbour library holds a path for all along.
	const neighbourAt = (position: number) => {
		const row = rowAt(position);
		return row === undefined
			? null
			: artworkAt(origin, playlistId ?? null, position, row);
	};

	const neighbours =
		isInOrder && position !== null && playlistId
			? {
					nextArtwork: neighbourAt(position + 1),
					previousArtwork: neighbourAt(position - 1),
				}
			: { nextArtwork: null, previousArtwork: null };

	// Read off the same window a neighbour would be: the address a neighbour's own fetch would have
	// produced for this position, so a slot already showing it is left alone once it becomes the
	// centre.
	const centreRow = position !== null ? rowAt(position) : undefined;
	const neighbourArtworkSrc =
		position !== null && playlistId && centreRow
			? (artworkAt(origin, playlistId, position, centreRow)?.src ?? null)
			: null;

	return { ...neighbours, neighbourArtworkSrc };
}
