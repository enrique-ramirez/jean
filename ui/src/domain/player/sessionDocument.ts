import type { QueryClient } from "@tanstack/react-query";

import { settle } from "@/shared/api/client";
import {
	readSession,
	type SessionDocument,
	type SessionReport,
} from "@/shared/api/sessions";
import type { PlaybackMode } from "@/shared/api/types";
import { useCacheOnly } from "@/shared/hooks/useCacheOnly";
import { useFooJean } from "@/shared/hooks/useFooJean";
import { deviceId } from "./device";
import { type FollowRevision, followRevision } from "./followRevision";
import { useInSession } from "./session";

export const SESSION_DOCUMENT_KEY = ["session"];
export const SESSION_RAISED_KEY = "jean.session.raised";

// `foo_jean`'s answer to a create carries no `sessionRevision`, so the document it seeds is taken to
// stand at `0`; a first poll that names another revision reads the document once.
const CREATED_REVISION = 0;

export interface RaisedMark {
	id: string;
	sequence: number;
}

function isRaisedMark(value: unknown): value is RaisedMark {
	if (typeof value !== "object" || value === null) return false;
	const { id, sequence } = value as Partial<Record<keyof RaisedMark, unknown>>;
	return typeof id === "string" && typeof sequence === "number";
}

export function raisedMark(): RaisedMark | null {
	try {
		const raw = sessionStorage.getItem(SESSION_RAISED_KEY);
		if (raw === null) return null;
		const stored: unknown = JSON.parse(raw);
		return isRaisedMark(stored) ? stored : null;
	} catch {
		// A browser's `sessionStorage` throws where storage is blocked, and `JSON.parse` on a value
		// somebody else wrote there.
		return null;
	}
}

export function markRaised(id: string, sequence: number): void {
	try {
		sessionStorage.setItem(
			SESSION_RAISED_KEY,
			JSON.stringify({ id, sequence } satisfies RaisedMark),
		);
	} catch {
		// A browser's `sessionStorage` throws in private mode and over its quota.
	}
}

function forgetRaised(): void {
	try {
		sessionStorage.removeItem(SESSION_RAISED_KEY);
	} catch {
		// A browser's `sessionStorage` throws where storage is blocked.
	}
}

export function unraisedReports(
	document: SessionDocument,
	mark: RaisedMark | null,
): SessionReport[] {
	if (mark === null || mark.id !== document.id) return [];
	return document.reports.filter((report) => report.sequence > mark.sequence);
}

const highestSequence = (document: SessionDocument) =>
	document.reports.reduce((top, report) => Math.max(top, report.sequence), 0);

// Reports already in the document when the tab enters the session are counted as raised.
function markEntered(document: SessionDocument): void {
	if (raisedMark()?.id === document.id) return;
	markRaised(document.id, highestSequence(document));
}

function holdDocument(client: QueryClient, document: SessionDocument): void {
	markEntered(document);
	client.setQueryData(SESSION_DOCUMENT_KEY, document);
}

interface DocumentFollower {
	follower: FollowRevision;
	session: string;
	seeded: number | null;
}

const followers = new WeakMap<QueryClient, DocumentFollower>();

function followerOf(client: QueryClient): DocumentFollower {
	const held = followers.get(client);
	if (held) return held;
	// TanStack Query garbage-collects an entry nothing observes, and the follower would go on
	// believing it holds what was dropped.
	client.setQueryDefaults(SESSION_DOCUMENT_KEY, { gcTime: Infinity });
	const following: DocumentFollower = {
		session: "",
		seeded: null,
		follower: followRevision<SessionDocument | undefined>({
			resource: "session",
			read: (origin) =>
				settle<SessionDocument | undefined>(
					readSession(origin, following.session, deviceId()),
				),
			apply: (document) => {
				if (document) holdDocument(client, document);
			},
		}),
	};
	followers.set(client, following);
	return following;
}

export function followSessionDocument(
	client: QueryClient,
	origin: string,
	session: string | null,
	revision: number,
): void {
	if (session === null) return;
	const following = followerOf(client);
	if (following.seeded === revision) return;
	following.seeded = null;
	following.session = session;
	following.follower.announce(origin, revision);
}

// TanStack Query's `removeQueries` drops the entry without telling a mounted observer, which goes
// on drawing what it held; `resetQueries` tells it.
export function forgetSessionDocument(client: QueryClient): void {
	const following = followerOf(client);
	following.follower.forget();
	following.seeded = null;
	forgetRaised();
	void client.resetQueries({ queryKey: SESSION_DOCUMENT_KEY });
}

export function seedSessionDocument(
	client: QueryClient,
	document: SessionDocument,
): void {
	forgetSessionDocument(client);
	followerOf(client).seeded = CREATED_REVISION;
	holdDocument(client, document);
}

export const useSessionDocument = (): SessionDocument | undefined =>
	useCacheOnly<SessionDocument>(SESSION_DOCUMENT_KEY).data;

const NOT_OFFERED: PlaybackMode[] = [];

export function useOfferedPlaybackModes(): PlaybackMode[] {
	const isInSession = useInSession();
	const document = useSessionDocument();
	const { discovery } = useFooJean();
	if (isInSession) return document?.playbackModes ?? NOT_OFFERED;
	return discovery.state.kind === "ready"
		? discovery.state.capabilities.playbackModes
		: NOT_OFFERED;
}
