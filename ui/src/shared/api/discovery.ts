import { ask, orNull, PROBE_TIMEOUT_MS, type Schema } from "./client";

export type FooJeanCapabilities = Schema["Capabilities"];

export type CapabilitiesResult =
	| { ok: true; capabilities: FooJeanCapabilities }
	| { ok: false; reason: "unreachable" };

export async function fetchCapabilities(
	origin: string,
): Promise<CapabilitiesResult> {
	const capabilities = await orNull(
		ask(origin, PROBE_TIMEOUT_MS, (api, init) =>
			api.GET("/capabilities", init),
		),
	);
	return capabilities
		? { ok: true, capabilities }
		: { ok: false, reason: "unreachable" };
}

export type FooJeanState =
	| { kind: "unreachable" }
	| { kind: "ready"; capabilities: FooJeanCapabilities };

export interface FooJeanDiscovery {
	state: FooJeanState;
	origin: string | null;
	retryable: boolean;
}

export const libraryOrigin = (discovery: FooJeanDiscovery) =>
	discovery.state.kind === "ready" &&
	discovery.state.capabilities.canReadLibrary
		? discovery.origin
		: null;

// Absent or unreached reads as writable: the field is read to take an affordance away and never to
// hand it out.
export const permitsPlaylistWrites = (discovery: FooJeanDiscovery) =>
	discovery.state.kind !== "ready" ||
	discovery.state.capabilities.canWritePlaylists !== false;

// Absent or unreached reads as permitted, for the same reason `permitsPlaylistWrites` does.
export const permitsPlaybackControl = (discovery: FooJeanDiscovery) =>
	discovery.state.kind !== "ready" ||
	discovery.state.capabilities.canControlPlayback !== false;

// Absent or unreached reads as permitted, for the same reason `permitsPlaybackControl` does.
export const permitsOutputChange = (discovery: FooJeanDiscovery) =>
	discovery.state.kind !== "ready" ||
	discovery.state.capabilities.canChangeOutput !== false;

export const isFooJeanReady = (discovery: FooJeanDiscovery) =>
	discovery.state.kind === "ready";

// A caller already inside a guarded control has `origin` as a nullable string, from
// `FooJeanDiscovery` or threaded down separately; this is the one throw every shape shares.
export function requireFooJean(origin: string | null): string {
	if (!origin) throw new Error("foo_jean is not reachable");
	return origin;
}

export async function discoverFooJean(): Promise<FooJeanDiscovery> {
	const origin = window.location.origin;

	const capabilities = await fetchCapabilities(origin);
	if (!capabilities.ok)
		return { state: { kind: "unreachable" }, origin, retryable: true };

	return {
		state: { kind: "ready", capabilities: capabilities.capabilities },
		origin,
		retryable: false,
	};
}
