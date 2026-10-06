import { useEffect, useSyncExternalStore } from "react";

import {
	fetchStreamListeners,
	type StreamListener,
	type StreamListeners,
} from "@/shared/api/stream";
import { translate } from "@/shared/i18n/locale";
import { subscribers } from "@/shared/lib/store";
import { deviceId } from "./device";
import {
	listenedSession,
	listeningLagSeconds,
	listenTarget,
	subscribeListening,
	targetEpoch,
} from "./listenerStore";

export type Watching = "off" | "background" | "open";

export const AUDIENCE_POLL_MS: Record<Exclude<Watching, "off">, number> = {
	open: 4000,
	background: 20_000,
};

export interface Audience {
	listeners: StreamListeners | null;
	lagSeconds: number | null;
}

const EMPTY: Audience = { listeners: null, lagSeconds: null };

interface Read {
	session: string | null;
	audience: Audience;
}

const store = subscribers();
let snapshot: Read = { session: null, audience: EMPTY };
let timer: ReturnType<typeof setInterval> | null = null;
let inFlightAt: number | null = null;

const watchers: Record<Exclude<Watching, "off">, number> = {
	open: 0,
	background: 0,
};

const publish = (next: Read) => {
	snapshot = next;
	store.notify();
};

async function poll() {
	const target = listenTarget();
	if (!target) {
		if (snapshot.audience !== EMPTY)
			publish({ session: null, audience: EMPTY });
		return;
	}

	const epoch = targetEpoch();
	if (inFlightAt === epoch) return;
	inFlightAt = epoch;
	try {
		const listeners = await fetchStreamListeners(target.origin);
		if (epoch !== targetEpoch()) return;
		publish({
			session: target.session,
			audience: {
				listeners: listeners.ok ? listeners.value : null,
				lagSeconds: listeningLagSeconds(),
			},
		});
	} finally {
		if (inFlightAt === epoch) inFlightAt = null;
	}
}

function retime() {
	if (timer) clearInterval(timer);
	timer = null;

	const wanted =
		watchers.open > 0 ? "open" : watchers.background > 0 ? "background" : null;
	if (wanted) timer = setInterval(() => void poll(), AUDIENCE_POLL_MS[wanted]);
}

function watch(mode: Exclude<Watching, "off">) {
	watchers[mode] += 1;
	retime();
	void poll();

	return () => {
		watchers[mode] -= 1;
		retime();
	};
}

const read = () => snapshot;

export function useAudience(watching: Watching): Audience {
	const session = useSyncExternalStore(subscribeListening, listenedSession);
	// biome-ignore lint/correctness/useExhaustiveDependencies: `session` fires this, so a move to another session reads its roster at once.
	useEffect(
		() => (watching === "off" ? undefined : watch(watching)),
		[watching, session],
	);
	const held = useSyncExternalStore(store.subscribe, read);
	return held.session === session ? held.audience : EMPTY;
}

export interface LabelledListener extends StreamListener {
	label: string;
}

export const deviceName = (name: string | null | undefined) =>
	name ?? translate("device.unknown");

export function numberedLabels() {
	const seen = new Map<string, number>();

	return (name: string) => {
		const nth = (seen.get(name) ?? 0) + 1;
		seen.set(name, nth);
		return nth > 1 ? `${name} (${nth})` : name;
	};
}

export function otherListeners(
	audience: Audience,
	self = deviceId(),
): LabelledListener[] {
	const labelled = numberedLabels();

	return (audience.listeners?.devices ?? [])
		.filter((device) => device.deviceId !== self)
		.map((device) => ({ ...device, label: labelled(deviceName(device.name)) }));
}

export const playerHeld = (audience: Audience) =>
	audience.listeners?.playerMuted === true;
