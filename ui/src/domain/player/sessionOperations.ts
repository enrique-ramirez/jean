import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";

import {
	type Answer,
	reach,
	refusalOf,
	unreachable,
} from "@/shared/api/client";
import { createSession } from "@/shared/api/sessions";
import { leaveStream } from "@/shared/api/stream";
import { useFooJean } from "@/shared/hooks/useFooJean";
import { deviceId, deviceIdentity } from "./device";
import {
	closeStream,
	connect,
	disconnect,
	isListening,
	listeningSnapshot,
} from "./listenerStore";
import { commitSession, ON_PLAYER, sessionSnapshot } from "./session";
import { seedSessionDocument } from "./sessionDocument";

export const LEAVE_RETRY_MS = 2_000;

export type SessionRefusal =
	| "full"
	| "unavailable"
	| "gone"
	| "unreachable"
	| "failed"
	| "pending";

export type SessionOutcome =
	| { ok: true }
	| { ok: false; reason: SessionRefusal; message: string };

export interface SessionContext {
	origin: string;
	recheck: () => void;
	queryClient: QueryClient;
}

const DONE: SessionOutcome = { ok: true };

const refused = (reason: SessionRefusal, message: string): SessionOutcome => ({
	ok: false,
	reason,
	message,
});

let isOperating = false;

async function oneAtATime(
	operation: () => Promise<SessionOutcome>,
): Promise<SessionOutcome> {
	if (isOperating) return refused("pending", "");
	isOperating = true;
	try {
		return await operation();
	} finally {
		isOperating = false;
	}
}

const isHeard = () => isListening(listeningSnapshot().phase);

// `foo_jean` does nothing with a leave that reaches it before it has noticed the stream's socket
// close, so the leave goes again once that has had time to happen. The second answers `404` where
// the first ended the session.
async function leaveOnceLetGo(
	letGo: Promise<void>,
	origin: string,
	id: string,
): Promise<void> {
	await letGo;
	await leaveStream(origin, deviceId(), id);
	setTimeout(() => {
		if (sessionSnapshot().id !== id) void leaveStream(origin, deviceId(), id);
	}, LEAVE_RETRY_MS);
}

function leaveHeld(origin: string): Promise<void> {
	const left = sessionSnapshot().id;
	if (left === null) return isHeard() ? disconnect() : Promise.resolve();
	const letGo = isHeard() ? closeStream() : Promise.resolve();
	return leaveOnceLetGo(letGo, origin, left);
}

function refusedCreate(
	{ response, error }: Answer<unknown>,
	recheck: () => void,
): SessionOutcome {
	const refusal = refusalOf(response, error);
	if (response.status !== 503) return refused("failed", refusal.message);
	if (refusal.error === "too many sessions")
		return refused("full", refusal.message);
	recheck();
	return refused("unavailable", refusal.message);
}

export const startSession = (context: SessionContext) =>
	oneAtATime(async () => {
		const created = await reach(
			createSession(context.origin, deviceIdentity()),
		);
		if (!created) return refused("unreachable", unreachable());
		if (!created.data) return refusedCreate(created, context.recheck);

		const { id } = created.data;
		const leaving = leaveHeld(context.origin);
		commitSession({ id, role: "listening" });
		seedSessionDocument(context.queryClient, created.data);
		await leaving;
		if (sessionSnapshot().id !== id) return refused("gone", "");
		connect();
		return DONE;
	});

async function leaveToPlayer(origin: string): Promise<SessionOutcome> {
	if (sessionSnapshot().id === null) return DONE;
	const leaving = leaveHeld(origin);
	commitSession(ON_PLAYER);
	await leaving;
	return DONE;
}

export const leaveSession = (context: SessionContext) =>
	oneAtATime(() => leaveToPlayer(context.origin));

export const stopListening = (context: SessionContext) =>
	oneAtATime(async () => {
		const { id, role } = sessionSnapshot();
		if (id === null) {
			await disconnect();
			return DONE;
		}
		if (role === "listening") return leaveToPlayer(context.origin);
		return DONE;
	});

export const startListening = (_context: SessionContext) =>
	oneAtATime(async () => {
		const { id, role } = sessionSnapshot();
		if (id !== null && role === "controlling")
			commitSession({ id, role: "listening" });
		connect();
		return DONE;
	});

export interface SessionActions {
	start: () => Promise<SessionOutcome>;
	listen: () => Promise<SessionOutcome>;
	stop: () => Promise<SessionOutcome>;
	leave: () => Promise<SessionOutcome>;
}

const refuseUnreachable = (): Promise<SessionOutcome> =>
	Promise.resolve(refused("unreachable", unreachable()));

const NO_PLAYER: SessionActions = {
	start: refuseUnreachable,
	listen: refuseUnreachable,
	stop: refuseUnreachable,
	leave: refuseUnreachable,
};

export function useSessionActions(): SessionActions {
	const { discovery, recheck } = useFooJean();
	const queryClient = useQueryClient();
	const { origin } = discovery;

	return useMemo(() => {
		if (!origin) return NO_PLAYER;
		const context = { origin, recheck, queryClient };
		return {
			start: () => startSession(context),
			listen: () => startListening(context),
			stop: () => stopListening(context),
			leave: () => leaveSession(context),
		};
	}, [origin, recheck, queryClient]);
}
