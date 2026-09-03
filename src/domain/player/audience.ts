import { useEffect, useSyncExternalStore } from "react";

import {
	fetchStreamListeners,
	releaseOutputHold,
	type StreamListener,
	type StreamListeners,
} from "@/shared/api/fooJean";
import { subscribers } from "@/shared/lib/store";
import { deviceId } from "./device";
import { listeningLagSeconds, listenTarget } from "./listenerStore";

// Who else is listening, and whether the player was silenced for them. The component is the only thing that can see a connection, so this is the one place either can be known.
// It is a roster and never a set of targets: audio cannot be sent to a device that is not already asking for it, because starting playback in a browser takes a gesture on that browser.

// How closely to watch. `open` is somebody looking at the picker or listening here; `background` is nobody looking, but the player is silent and the count on the button is what says why.
export type Watching = "off" | "background" | "open";

// Quick enough that somebody joining appears while the picker is still open, and slow enough in the background that a player muted by hand — which looks the same from beefweb — costs three requests a minute rather than fifteen.
const POLL_MS: Record<Exclude<Watching, "off">, number> = {
	open: 4000,
	background: 20_000,
};

export interface Audience {
	listeners: StreamListeners | null;
	// Sampled on the same tick, because the one line that needs it is drawn beside the roster and it must not be published per frame.
	lagSeconds: number | null;
}

const EMPTY: Audience = { listeners: null, lagSeconds: null };

const store = subscribers();
let snapshot: Audience = EMPTY;
let timer: ReturnType<typeof setInterval> | null = null;
let inFlight = false;

// Counted per mode, because the picker is mounted once per viewport: one of them unmounting must not stop the other's polling, and the two need not be watching at the same rate.
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

	// One request at a time: a slow answer must not queue another behind it.
	if (inFlight) return;
	inFlight = true;
	try {
		const listeners = await fetchStreamListeners(target.origin, target.token);
		publish({ listeners, lagSeconds: listeningLagSeconds() });
	} finally {
		inFlight = false;
	}
}

// The fastest rate anybody asked for, or nothing at all when nobody did.
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

// An install where nobody looks, nobody listens and the player is audible sends no requests at all.
export function useAudience(watching: Watching): Audience {
	useEffect(
		() => (watching === "off" ? undefined : watch(watching)),
		[watching],
	);
	return useSyncExternalStore(store.subscribe, read, read);
}

// Optimistic, because the roster is on a four-second poll and a button that takes four seconds to answer reads as broken. The next poll is what confirms it.
export function releasePlayer() {
	const target = listenTarget();
	if (!target) return;

	if (snapshot.listeners) {
		publish({
			...snapshot,
			listeners: { ...snapshot.listeners, playerMuted: false },
		});
	}

	void releaseOutputHold(target.origin, target.token).then(() => void poll());
}

export interface LabelledListener extends StreamListener {
	label: string;
}

// This device is a row of its own in the picker, so it is never also one of the others.
// Two phones of the same make report the same name, and a list with two identical rows says nothing; the ordinal is what makes them tellable apart, Finder style, so the first of a name keeps it.
export function otherListeners(
	audience: Audience,
	self = deviceId(),
): LabelledListener[] {
	const seen = new Map<string, number>();

	return (audience.listeners?.devices ?? [])
		.filter((device) => device.deviceId !== self)
		.map((device) => {
			// A client that named nothing still occupies a row, and an empty one would read as a bug.
			const name = device.name ?? "Unknown device";
			const nth = (seen.get(name) ?? 0) + 1;
			seen.set(name, nth);
			return { ...device, label: nth > 1 ? `${name} (${nth})` : name };
		});
}

// Whether the player is silent because of a listener rather than because somebody muted it. False until the roster has been read, so nothing claims a reason it does not have yet.
export const playerHeld = (audience: Audience) =>
	audience.listeners?.playerMuted === true;
