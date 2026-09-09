import {
	fetchPlayQueue,
	QUEUE_FIELD,
	removeFromPlayQueue,
} from "@/shared/api/beefweb";
import type { PlayQueueItem } from "@/shared/api/types";
import { descending, inSequence } from "@/shared/lib/sequence";

export const QUEUE_KEY = ["playQueue"];
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

export function insertPlan(
	current: PlayQueueItem[],
	at: number,
	added: QueueTarget[],
) {
	const from = Math.max(0, Math.min(at, current.length));
	return {
		removals: descending(current.length - 1, from),
		additions: [...added, ...current.slice(from)],
	};
}

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

export async function dequeuePlaylist(playlistId: string) {
	const queued = await fetchPlayQueue().catch(() => null);
	if (!queued) return false;

	const at = queued
		.map((item, index) => (item.playlistId === playlistId ? index : -1))
		.filter((index) => index >= 0)
		.reverse();

	await inSequence(at, removeFromPlayQueue);

	const after = await fetchPlayQueue().catch(() => null);
	return Boolean(after?.every((item) => item.playlistId !== playlistId));
}
