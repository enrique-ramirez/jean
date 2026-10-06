import { useSyncExternalStore } from "react";

import { type SessionScope, setSessionScope } from "@/shared/api/client";
import { subscribers } from "@/shared/lib/store";
import { deviceId } from "./device";
import { awaitPress, configureListening, listenTarget } from "./listenerStore";

export const SESSION_KEY = "jean.session";

const PLAYER_SESSION_ID = "engine";

export type SessionRole = "listening" | "controlling";
export type SessionNotice = { kind: "ended" | "nobodyListening"; id: string };

type Membership = { id: null; role: null } | { id: string; role: SessionRole };

export type SessionSnapshot = Readonly<
	Membership & { notice: SessionNotice | null }
>;

interface StoredSession {
	id: string;
	listening: boolean;
}

export const ON_PLAYER: Membership = { id: null, role: null };

const listeners = subscribers();

const parseJson = (raw: string): unknown => {
	try {
		return JSON.parse(raw);
	} catch {
		return null;
	}
};

function isStoredSession(value: unknown): value is StoredSession {
	if (typeof value !== "object" || value === null) return false;
	const { id, listening } = value as Partial<
		Record<keyof StoredSession, unknown>
	>;
	return (
		typeof id === "string" &&
		id !== "" &&
		id !== PLAYER_SESSION_ID &&
		typeof listening === "boolean"
	);
}

function restore(): Membership {
	try {
		const raw = sessionStorage.getItem(SESSION_KEY);
		if (raw === null) return ON_PLAYER;
		const stored = parseJson(raw);
		if (isStoredSession(stored))
			return {
				id: stored.id,
				role: stored.listening ? "listening" : "controlling",
			};
		sessionStorage.removeItem(SESSION_KEY);
	} catch {
		// A browser's `sessionStorage` throws where storage is blocked, and Node has none.
	}
	return ON_PLAYER;
}

function persist(next: Membership) {
	try {
		if (next.id === null) sessionStorage.removeItem(SESSION_KEY);
		else
			sessionStorage.setItem(
				SESSION_KEY,
				JSON.stringify({
					id: next.id,
					listening: next.role === "listening",
				} satisfies StoredSession),
			);
	} catch {
		// A browser's `sessionStorage` throws in private mode and over its quota.
	}
}

const scopeOf = (id: string | null): SessionScope | null =>
	id === null ? null : { session: id, deviceId: deviceId() };

const restored = restore();
let snapshot: SessionSnapshot = { ...restored, notice: null };
let epoch = 0;
setSessionScope(scopeOf(restored.id));
if (restored.role === "listening") awaitPress();

export const subscribeSession = listeners.subscribe;
export const sessionSnapshot = (): SessionSnapshot => snapshot;
export const sessionEpoch = (): number => epoch;
export const inSession = (): boolean => snapshot.id !== null;
const sessionId = (): string | null => snapshot.id;

export function commitSession(next: Membership, notice?: SessionNotice): void {
	const held = listenTarget();
	if (held) configureListening({ ...held, session: next.id });
	setSessionScope(scopeOf(next.id));
	persist(next);
	if (next.id !== snapshot.id) epoch += 1;
	snapshot = { ...next, notice: notice ?? null };
	listeners.notify();
}

export function noteSessionGone(id: string): void {
	if (snapshot.id !== id) return;
	commitSession(ON_PLAYER, { kind: "ended", id });
}

export function acknowledgeNotice(notice: SessionNotice): boolean {
	if (snapshot.notice !== notice) return false;
	snapshot = { ...snapshot, notice: null };
	listeners.notify();
	return true;
}

export const useSession = (): SessionSnapshot =>
	useSyncExternalStore(subscribeSession, sessionSnapshot);

export const useSessionId = (): string | null =>
	useSyncExternalStore(subscribeSession, sessionId);

export const useInSession = (): boolean =>
	useSyncExternalStore(subscribeSession, inSession);
