import type { QueryClient } from "@tanstack/react-query";

import {
	type FillPlaylistRequest,
	fetchQueue,
	type QueueRead,
	removeQueueEntry,
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

const matchingIndices = (entries: QueueRead["entries"], guid: string | null) =>
	entries.reduce<number[]>((indices, entry, at) => {
		if (entry.location?.playlistId === guid) indices.push(at);
		return indices;
	}, []);

const MAX_CONSECUTIVE_STALE_REREADS = 3;

// The revision math rests on the component bumping it by exactly one per accepted
// mutation; see ../../shared/api/README.md, *What Jean does about the queue*.
export async function dequeuePlaylist(
	origin: string,
	token: string,
	guid: string | null,
): Promise<boolean> {
	let read = await fetchQueue(origin, token);
	if (!read) return false;

	let revision = read.revision;
	let pending = matchingIndices(read.entries, guid);
	let staleRereads = 0;

	while (pending.length > 0) {
		const at = pending.pop();
		if (at === undefined) break;

		const removed = await removeQueueEntry(origin, token, at, revision);
		if (removed.ok) {
			revision += 1;
			staleRereads = 0;
			continue;
		}
		if (removed.reason === "failed") return false;

		staleRereads += 1;
		if (staleRereads > MAX_CONSECUTIVE_STALE_REREADS) return false;

		read = await fetchQueue(origin, token);
		if (!read) return false;
		revision = read.revision;
		pending = matchingIndices(read.entries, guid);
	}
	return true;
}
