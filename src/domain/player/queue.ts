import {
	fetchPlayQueue,
	QUEUE_FIELD,
	removeFromPlayQueue,
} from "@/shared/api/beefweb";
import type { PlayQueueItem } from "@/shared/api/types";
import { descending, inSequence } from "@/shared/lib/sequence";

export const QUEUE_KEY = ["playQueue"];
export const QUEUE_DROP_TARGET = "jean:queue";

// Here rather than in `useQueue` so `usePlayer` can consult it without the two importing each other. A counter, because two mutations can overlap.
let held = 0;

export const isQueueStreamHeld = () => held > 0;

export const holdQueue = () => {
	held += 1;
	let released = false;
	return () => {
		if (released) return;
		released = true;
		held -= 1;
	};
};

export interface QueueEntry {
	at: number;
	playlistId: string;
	itemIndex: number;
	title: string;
	artist: string;
	duration: number;
	offset: number;
	// beefweb reports `itemIndex: -1` for a track removed from its playlist and leaves `columns` holding whatever fell into the freed slot, so branch on the index and never on the columns.
	isOrphan: boolean;
}

const seconds = (raw: string | undefined) => {
	const parsed = Number(raw);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

export function readQueue(items: PlayQueueItem[] | undefined): QueueEntry[] {
	let offset = 0;

	return (items ?? []).map((item, at) => {
		const isOrphan = item.itemIndex < 0;
		const duration = isOrphan
			? 0
			: seconds(item.columns?.[QUEUE_FIELD.duration]);
		const entry: QueueEntry = {
			at,
			playlistId: item.playlistId,
			itemIndex: item.itemIndex,
			title: isOrphan ? "" : (item.columns?.[QUEUE_FIELD.title] ?? ""),
			artist: isOrphan ? "" : (item.columns?.[QUEUE_FIELD.artist] ?? ""),
			duration,
			offset,
			isOrphan,
		};
		offset += duration;
		return entry;
	});
}

export const queuedSeconds = (entries: QueueEntry[]) =>
	entries.reduce((total, entry) => total + entry.duration, 0);

export const startsIn = (entry: QueueEntry, remaining: number) =>
	remaining + entry.offset;

// A reorder is a rebuild, because `queueIndex` on `/playqueue/add` is accepted and silently ignored: there is no insert to ask for.
// Everything above the earlier of the two positions is untouched, so a drag near the bottom is cheap and one from the top is not. Removals come off from the top, because the player renumbers on every one.
export function movePlan(current: PlayQueueItem[], from: number, to: number) {
	const next = [...current];
	const [item] = next.splice(from, 1);
	next.splice(to, 0, item);

	const at = Math.min(from, to);
	return {
		next,
		removals: descending(current.length - 1, at),
		additions: next.slice(at),
	};
}

export const sameQueue = (
	a: PlayQueueItem[] | undefined,
	b: PlayQueueItem[] | undefined,
) =>
	(a?.length ?? 0) === (b?.length ?? 0) &&
	(a ?? []).every(
		(item, at) =>
			item.playlistId === b?.[at]?.playlistId &&
			item.itemIndex === b?.[at]?.itemIndex,
	);

// Deleting a playlist the queue points into crashes foo_beefweb and takes foobar2000 with it, so this runs first and its answer gates the delete.
export async function dequeuePlaylist(playlistId: string) {
	const queued = await fetchPlayQueue().catch(() => null);
	if (!queued) return false;

	// Highest first: every removal renumbers the entries after it.
	const at = queued
		.map((item, index) => (item.playlistId === playlistId ? index : -1))
		.filter((index) => index >= 0)
		.reverse();

	await inSequence(at, removeFromPlayQueue);

	const after = await fetchPlayQueue().catch(() => null);
	return Boolean(after?.every((item) => item.playlistId !== playlistId));
}
