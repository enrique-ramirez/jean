const SETTLE_MS = 100;

// `kMissingCoverCacheLifetimeSeconds` in `plugins/fb2k/src/core/http_server.cpp`: ten minutes, so a
// cover added at the player is asked about again within the same window the component's own `404`
// would have expired in.
const FAILURE_FORGET_MS = 600_000;

// A browser gives one origin six HTTP/1.1 connections, and covers share that budget with whatever
// else the origin is answering.
const MAX_IN_FLIGHT = 3;

export type ArtworkOutcome = "ok" | "failed";

interface QueueEntry {
	key: string;
	grant: () => void;
	released: boolean;
	pending: number;
}

const waiting: QueueEntry[] = [];
let inFlight = 0;

const SEEN_LIMIT = 4096;
let seen = new Map<string, ArtworkOutcome>();

const forgetTimers = new Map<string, ReturnType<typeof setTimeout>>();
const forgetListeners = new Map<string, Set<() => void>>();

export const outcomeFor = (key: string) => seen.get(key);

export function onForgotten(key: string, listener: () => void): () => void {
	let listeners = forgetListeners.get(key);
	if (!listeners) {
		listeners = new Set();
		forgetListeners.set(key, listeners);
	}
	listeners.add(listener);

	return () => {
		listeners?.delete(listener);
		if (listeners?.size === 0) forgetListeners.delete(key);
	};
}

const remember = (key: string, outcome: ArtworkOutcome) => {
	if (seen.size >= SEEN_LIMIT) seen = new Map();
	seen.set(key, outcome);

	const pending = forgetTimers.get(key);
	if (pending) {
		clearTimeout(pending);
		forgetTimers.delete(key);
	}

	if (outcome !== "failed") return;

	forgetTimers.set(
		key,
		setTimeout(() => {
			forgetTimers.delete(key);
			seen.delete(key);
			for (const listener of forgetListeners.get(key) ?? []) listener();
		}, FAILURE_FORGET_MS),
	);
};

const pump = () => {
	const starting = waiting.splice(0, MAX_IN_FLIGHT - inFlight);
	inFlight += starting.length;
	starting.forEach((entry) => {
		entry.grant();
	});
};

export function requestArtwork(key: string, grant: () => void) {
	const entry: QueueEntry = { key, grant, released: false, pending: 0 };

	entry.pending = setTimeout(() => {
		entry.pending = 0;
		waiting.push(entry);
		pump();
	}, SETTLE_MS);

	return (outcome?: ArtworkOutcome) => {
		if (entry.released) return;
		entry.released = true;
		if (outcome) remember(key, outcome);

		if (entry.pending) {
			clearTimeout(entry.pending);
			entry.pending = 0;
			return;
		}

		const queued = waiting.indexOf(entry);
		if (queued >= 0) {
			waiting.splice(queued, 1);
			return;
		}

		inFlight -= 1;
		pump();
	};
}
