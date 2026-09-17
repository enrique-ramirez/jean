import type { QueryClient } from "@tanstack/react-query";

import {
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
	isOrphan: boolean;
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
			// A queued entry plays whether or not it still carries a `location`: see `../../shared/api/README.md`,
			// "What Jean does about the queue".
			isOrphan: false,
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

const MAX_DEQUEUE_ATTEMPTS = 64;

export async function dequeuePlaylist(
	origin: string,
	token: string,
	guid: string,
): Promise<boolean> {
	for (let attempt = 0; attempt < MAX_DEQUEUE_ATTEMPTS; attempt += 1) {
		const read = await fetchQueue(origin, token);
		if (!read) return false;

		const at = read.entries.findIndex(
			(entry) => entry.location?.playlistId === guid,
		);
		if (at < 0) return true;

		const removed = await removeQueueEntry(origin, token, at, read.revision);
		if (!removed.ok && removed.reason === "failed") return false;
	}
	return false;
}
