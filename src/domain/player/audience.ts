import { useEffect, useSyncExternalStore } from "react";

import {
	fetchStreamListeners,
	type StreamListener,
	type StreamListeners,
} from "@/shared/api/fooJean";
import { translate } from "@/shared/i18n/locale";
import { subscribers } from "@/shared/lib/store";
import { deviceId } from "./device";
import { listeningLagSeconds, listenTarget } from "./listenerStore";

export type Watching = "off" | "background" | "open";

const POLL_MS: Record<Exclude<Watching, "off">, number> = {
	open: 4000,
	background: 20_000,
};

export interface Audience {
	listeners: StreamListeners | null;
	// Sampled on the same tick rather than published: it moves continuously, and a store notifying on
	// it would repaint the app.
	lagSeconds: number | null;
}

const EMPTY: Audience = { listeners: null, lagSeconds: null };

const store = subscribers();
let snapshot: Audience = EMPTY;
let timer: ReturnType<typeof setInterval> | null = null;
let inFlight = false;

const watchers: Record<Exclude<Watching, "off">, number> = {
	open: 0,
	background: 0,
};

const publish = (next: Audience) => {
	snapshot = next;
	store.notify();
};

async function poll() {
	const target = listenTarget();
	if (!target) {
		if (snapshot !== EMPTY) publish(EMPTY);
		return;
	}

	if (inFlight) return;
	inFlight = true;
	try {
		const listeners = await fetchStreamListeners(target.origin, target.token);
		publish({ listeners, lagSeconds: listeningLagSeconds() });
	} finally {
		inFlight = false;
	}
}

function retime() {
	if (timer) clearInterval(timer);
	timer = null;

	const wanted =
		watchers.open > 0 ? "open" : watchers.background > 0 ? "background" : null;
	if (wanted) timer = setInterval(() => void poll(), POLL_MS[wanted]);
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
	useEffect(
		() => (watching === "off" ? undefined : watch(watching)),
		[watching],
	);
	return useSyncExternalStore(store.subscribe, read, read);
}

export interface LabelledListener extends StreamListener {
	label: string;
}

export function otherListeners(
	audience: Audience,
	self = deviceId(),
): LabelledListener[] {
	const seen = new Map<string, number>();

	return (audience.listeners?.devices ?? [])
		.filter((device) => device.deviceId !== self)
		.map((device) => {
			const name = device.name ?? translate("device.unknown");
			const nth = (seen.get(name) ?? 0) + 1;
			seen.set(name, nth);
			return { ...device, label: nth > 1 ? `${name} (${nth})` : name };
		});
}

export const playerHeld = (audience: Audience) =>
	audience.listeners?.playerMuted === true;
