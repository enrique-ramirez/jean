import type { QueryClient } from "@tanstack/react-query";

import { LIBRARY_ROLES } from "@/domain/track/libraryAsker";
import type {
	FillPlaylistRequest,
	PlaylistAnnotation,
} from "@/shared/api/playlists";
import { fetchQueue, type QueueRead } from "@/shared/api/queue";
import type { ActiveItem } from "@/shared/api/types";
import { type FollowRevision, followRevision } from "./followRevision";

export const QUEUE_KEY = ["queue"];
export const QUEUE_DROP_TARGET = "jean:queue";

interface QueueTarget {
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
	cover: string | null;
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
			cover: entry.cover ?? null,
			location: entry.location,
		};
		offset += duration;
		return built;
	});
}

export function isQueueHead(
	read: QueueRead | undefined,
	playing: ActiveItem | undefined,
): boolean {
	const head = read?.entries[0];
	if (!head || !playing) return false;

	const isHeadRow =
		head.location !== null &&
		head.location.playlistId === playing.playlistGuid &&
		head.location.index === playing.index;
	const isHeadTrack =
		head.libraryPath !== null && head.libraryPath === playing.libraryPath;
	return isHeadRow || isHeadTrack;
}

export const queuedSeconds = (entries: QueueEntry[]) =>
	entries.reduce((total, entry) => total + entry.duration, 0);

export const startsIn = (entry: QueueEntry, remaining: number) =>
	remaining + entry.offset;

const queueFollowers = new WeakMap<QueryClient, FollowRevision>();

function queueFollower(client: QueryClient): FollowRevision {
	let follower = queueFollowers.get(client);
	if (!follower) {
		// `held` is the only record of what has already been read, so `QUEUE_KEY` must not be
		// garbage-collected out from under it: React Query otherwise drops the entry after five
		// minutes with no observer, on a route with no queue button mounted, and an unmoved
		// revision would then never be told to re-announce.
		client.setQueryDefaults(QUEUE_KEY, { gcTime: Infinity });
		follower = followRevision<QueueRead>({
			resource: "queue",
			read: (origin) => fetchQueue(origin, LIBRARY_ROLES),
			apply: (read) => client.setQueryData(QUEUE_KEY, read),
		});
		queueFollowers.set(client, follower);
	}
	return follower;
}

export function followQueue(
	client: QueryClient,
	origin: string,
	revision: number,
): void {
	queueFollower(client).announce(origin, revision);
}

// TanStack Query's `removeQueries` drops the entry without telling a mounted observer, which goes
// on drawing what it held; `resetQueries` tells it.
export function forgetQueue(client: QueryClient): void {
	queueFollower(client).forget();
	void client.resetQueries({ queryKey: QUEUE_KEY });
}
