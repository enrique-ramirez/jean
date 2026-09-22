import type { QueryClient } from "@tanstack/react-query";

import {
	type FillPlaylistRequest,
	fetchQueue,
	type PlaylistAnnotation,
	type QueueRead,
} from "@/shared/api/fooJean";

export const QUEUE_KEY = ["queue"];
export const QUEUE_DROP_TARGET = "jean:queue";

export interface QueueTarget {
	playlistId: string;
	itemIndex: number;
}

// What a source hands `useQueueActions.queue()`: a playlist's own rows, addressed by position,
// or a set of library tracks, addressed by handle.
export type QueueSource =
	| { kind: "rows"; targets: QueueTarget[] }
	| { kind: "tracks"; request: FillPlaylistRequest };

// Validates rather than converts: every id a caller holds is already the GUID `GET /playlists`
// answers, and this confirms it names a playlist the annotation list still carries.
export function guidOf(
	id: string,
	entries: readonly PlaylistAnnotation[] | null,
): string {
	const entry = entries?.find((annotation) => annotation.id === id);
	if (!entry) throw new Error(`no foo_jean playlist for id ${id}`);
	return entry.id;
}

export const queueDropAt = (at: number) => `${QUEUE_DROP_TARGET}@${at}`;

export const queueDropIndex = (id: string) => {
	if (!id.startsWith(`${QUEUE_DROP_TARGET}@`)) return null;
	const at = Number(id.slice(QUEUE_DROP_TARGET.length + 1));
	return Number.isInteger(at) ? at : null;
};

export interface QueueEntry {
	at: number;
	title: string;
	artist: string;
	album: string;
	albumArtist: string;
	duration: number;
	offset: number;
	libraryPath: string | null;
	location: { playlistId: string; index: number } | null;
}

export function readQueue(read: QueueRead | undefined): QueueEntry[] {
	let offset = 0;

	return (read?.entries ?? []).map((entry, at) => {
		const duration = entry.duration > 0 ? entry.duration : 0;
		const built: QueueEntry = {
			at,
			title: entry.title,
			artist: entry.artist,
			album: entry.album,
			albumArtist: entry.albumArtist,
			duration,
			offset,
			libraryPath: entry.libraryPath,
			location: entry.location,
		};
		offset += duration;
		return built;
	});
}

export const queuedSeconds = (entries: QueueEntry[]) =>
	entries.reduce((total, entry) => total + entry.duration, 0);

export const startsIn = (entry: QueueEntry, remaining: number) =>
	remaining + entry.offset;

export async function recheckQueue(
	client: QueryClient,
	origin: string,
	token: string,
	revision: number,
): Promise<void> {
	const cached = client.getQueryData<QueueRead>(QUEUE_KEY);
	if (cached?.revision === revision) return;

	const read = await fetchQueue(origin, token);
	if (read) client.setQueryData(QUEUE_KEY, read);
}
