import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";

import {
	type Answer,
	reach,
	refusalOf,
	unreachable,
} from "@/shared/api/client";
import { createSession, shareSession } from "@/shared/api/sessions";
import { fetchState, type StateFailureReason } from "@/shared/api/state";
import {
	issueStreamTicket,
	leaveStream,
	type TicketFailure,
} from "@/shared/api/stream";
import { useFooJean } from "@/shared/hooks/useFooJean";
import { deviceId, deviceIdentity } from "./device";
import {
	closeStream,
	connect,
	disconnect,
	isListening,
	listeningSnapshot,
} from "./listenerStore";
import { withdrawStart } from "./offersStart";
import {
	commitSession,
	ON_PLAYER,
	type SessionNotice,
	sessionSnapshot,
} from "./session";
import {
	holdDocument,
	rememberListedCreator,
	seedSessionDocument,
} from "./sessionDocument";
import { SESSIONS_KEY } from "./sessionList";

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

const relist = (queryClient: QueryClient) =>
	void queryClient.invalidateQueries({ queryKey: SESSIONS_KEY });

let sharingFlip: Promise<SessionOutcome> | null = null;

// `foo_jean` does nothing with a leave that reaches it before it has noticed the stream's socket
// close, so the leave goes again once that has had time to happen. The second answers `404` where
// the first ended the session.
async function leaveOnceLetGo(
	letGo: Promise<void>,
	origin: string,
	id: string,
): Promise<void> {
	await letGo;
	// `foo_jean` makes the device that sends a sharing change a member of the session, so a leave
	// reaching it before a change in flight would leave the device in.
	await sharingFlip?.catch(() => undefined);
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
	{ recheck, queryClient }: SessionContext,
): SessionOutcome {
	const refusal = refusalOf(response, error);
	if (response.status !== 503) return refused("failed", refusal.message);
	if (refusal.error === "too many sessions")
		return refused("full", refusal.message);
	withdrawStart(queryClient);
	recheck();
	return refused("unavailable", refusal.message);
}

export const startSession = (context: SessionContext) =>
	oneAtATime(async () => {
		const created = await reach(
			createSession(context.origin, deviceIdentity()),
		);
		if (!created) return refused("unreachable", unreachable());
		if (!created.data) return refusedCreate(created, context);

		const { id } = created.data;
		const leaving = leaveHeld(context.origin);
		commitSession({ id, role: "listening" });
		seedSessionDocument(context.queryClient, created.data);
		relist(context.queryClient);
		await leaving;
		if (sessionSnapshot().id !== id) return refused("gone", "");
		connect();
		return DONE;
	});

async function leaveToPlayer(
	{ origin, queryClient }: Pick<SessionContext, "origin" | "queryClient">,
	notice?: SessionNotice,
): Promise<SessionOutcome> {
	if (sessionSnapshot().id === null) return DONE;
	const leaving = leaveHeld(origin);
	commitSession(ON_PLAYER, notice);
	relist(queryClient);
	await leaving;
	return DONE;
}

export const leaveSession = (
	context: Pick<SessionContext, "origin" | "queryClient">,
	notice?: SessionNotice,
) => oneAtATime(() => leaveToPlayer(context, notice));

export const stopListening = (context: SessionContext) =>
	oneAtATime(async () => {
		const { id, role } = sessionSnapshot();
		if (id === null) {
			await disconnect();
			return DONE;
		}
		if (role === "listening") return leaveToPlayer(context);
		return DONE;
	});

const TICKET_REFUSAL: Record<TicketFailure["reason"], SessionRefusal> = {
	busy: "unavailable",
	unavailable: "unavailable",
	unreachable: "unreachable",
	gone: "gone",
};

async function listenWhereThisTabIs(origin: string): Promise<SessionOutcome> {
	const { id, role } = sessionSnapshot();
	if (id === null || role !== "controlling") {
		connect();
		return DONE;
	}

	const issued = await issueStreamTicket(origin, deviceIdentity(), id);
	if (!issued.ok) return refused(TICKET_REFUSAL[issued.reason], issued.message);
	if (sessionSnapshot().id !== id) return refused("gone", "");
	commitSession({ id, role: "listening" });
	connect(issued.ticket);
	return DONE;
}

export const startListening = ({ origin }: SessionContext) =>
	oneAtATime(() => listenWhereThisTabIs(origin));

export const joinToListen = (
	{ origin, queryClient }: SessionContext,
	id: string,
) =>
	oneAtATime(async () => {
		const here = sessionSnapshot();
		if (here.id === id)
			return here.role === "controlling" ? listenWhereThisTabIs(origin) : DONE;

		const playerWasHeard = here.id === null && isHeard();
		if (playerWasHeard) await disconnect();
		const issued = await issueStreamTicket(origin, deviceIdentity(), id);
		if (!issued.ok) {
			if (playerWasHeard) connect();
			return refused(TICKET_REFUSAL[issued.reason], issued.message);
		}

		const leaving = leaveHeld(origin);
		rememberListedCreator(queryClient, id);
		commitSession({ id, role: "listening" });
		relist(queryClient);
		await leaving;
		if (sessionSnapshot().id !== id) return refused("gone", "");
		connect(issued.ticket);
		return DONE;
	});

const PROBE_REFUSAL: Record<StateFailureReason, SessionRefusal> = {
	noSuchSession: "gone",
	unavailable: "unavailable",
	unreachable: "unreachable",
	failed: "failed",
};

export const joinToControl = (
	{ origin, queryClient }: SessionContext,
	id: string,
) =>
	oneAtATime(async () => {
		if (sessionSnapshot().id === id) return DONE;

		const probed = await fetchState(origin, null, undefined, {
			session: id,
			deviceId: deviceId(),
		});
		if (!probed.ok) return refused(PROBE_REFUSAL[probed.reason], probed.detail);

		const leaving = leaveHeld(origin);
		rememberListedCreator(queryClient, id);
		commitSession({ id, role: "controlling" });
		relist(queryClient);
		await leaving;
		return DONE;
	});

async function flipSharing(
	{ origin, queryClient }: SessionContext,
	id: string,
	shared: boolean,
): Promise<SessionOutcome> {
	const answered = await reach(shareSession(origin, id, deviceId(), shared));
	if (!answered) return refused("unreachable", unreachable());
	if (!answered.data) {
		const refusal = refusalOf(answered.response, answered.error);
		const reason = answered.response.status === 404 ? "gone" : "failed";
		return refused(reason, refusal.message);
	}
	if (sessionSnapshot().id === id) holdDocument(queryClient, answered.data);
	relist(queryClient);
	return DONE;
}

export async function setSessionShared(
	context: SessionContext,
	shared: boolean,
): Promise<SessionOutcome> {
	const { id } = sessionSnapshot();
	if (id === null) return refused("failed", "");
	if (sharingFlip) return refused("pending", "");
	const flip = flipSharing(context, id, shared);
	sharingFlip = flip;
	try {
		return await flip;
	} finally {
		sharingFlip = null;
	}
}

export interface SessionActions {
	start: () => Promise<SessionOutcome>;
	listen: () => Promise<SessionOutcome>;
	listenTo: (id: string) => Promise<SessionOutcome>;
	control: (id: string) => Promise<SessionOutcome>;
	stop: () => Promise<SessionOutcome>;
	leave: () => Promise<SessionOutcome>;
	share: (shared: boolean) => Promise<SessionOutcome>;
}

const refuseUnreachable = (): Promise<SessionOutcome> =>
	Promise.resolve(refused("unreachable", unreachable()));

const NO_PLAYER: SessionActions = {
	start: refuseUnreachable,
	listen: refuseUnreachable,
	listenTo: refuseUnreachable,
	control: refuseUnreachable,
	stop: refuseUnreachable,
	leave: refuseUnreachable,
	share: refuseUnreachable,
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
			listenTo: (id: string) => joinToListen(context, id),
			control: (id: string) => joinToControl(context, id),
			stop: () => stopListening(context),
			leave: () => leaveSession(context),
			share: (shared: boolean) => setSessionShared(context, shared),
		};
	}, [origin, recheck, queryClient]);
}
