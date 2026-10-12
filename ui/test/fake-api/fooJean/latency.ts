import type { Responder } from "../http.ts";
import type { FooJeanFake } from "./options.ts";

export const delay = (ms: number) =>
	new Promise((resolve) => setTimeout(resolve, ms));

// How long the handler for a read that never answers waits for the client to go
// away. Jean abandons that read 35 seconds later, which no spec can sit through,
// so a spec proving the page stayed quiet about it waits out this instead: past
// it, nothing from the read can arrive any more.
export const STALLED_READ_MS = 1000;

// Bounded, so a client that waits forever still gets its socket back.
export const abandoned = (response: Responder, within: number) =>
	new Promise<boolean>((resolve) => {
		const timer = setTimeout(() => resolve(false), within);
		response.on("close", () => {
			clearTimeout(timer);
			resolve(true);
		});
	});

export const latencyOf = (fake: FooJeanFake, method: string, path: string) => {
	const asked = `${method} ${path}`;
	const match = Object.entries(fake.routeLatency).find(([route]) =>
		asked.startsWith(route),
	)?.[1];
	if (!match) return 0;
	return match.ms + Math.random() * (match.jitterMs ?? 0);
};

// Everything a route does to its response, replayed in order once `ms` has passed.
export const deliveredAfter = (response: Responder, ms: number): Responder => {
	const pending: (() => unknown)[] = [];
	let open = false;
	let ended = false;
	setTimeout(() => {
		open = true;
		for (const step of pending.splice(0)) step();
	}, ms);
	const later = (step: () => unknown) => {
		if (open) return step();
		pending.push(step);
		return true;
	};
	return {
		writeHead: (status, headers) =>
			later(() => response.writeHead(status, headers)),
		setHeader: (name, value) => later(() => response.setHeader(name, value)),
		write: (chunk) => later(() => response.write(chunk)),
		end: (body) => {
			ended = true;
			return later(() => response.end(body));
		},
		on: (event, listener) => response.on(event, listener),
		destroy: () => response.destroy(),
		get writableEnded() {
			return ended || Boolean(response.writableEnded);
		},
	};
};
