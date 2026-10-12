import assert from "node:assert/strict";
import { type ClientRequest, get } from "node:http";
import { mock, type TestContext } from "node:test";

import { QueryClient } from "@tanstack/react-query";

import { deviceId } from "../../src/domain/player/device.ts";
import {
	configureListening,
	isListening,
	listeningSnapshot,
} from "../../src/domain/player/listenerStore.ts";
import { startPlayerPoll } from "../../src/domain/player/playerPoll.ts";
import {
	commitSession,
	SESSION_KEY,
	sessionSnapshot,
} from "../../src/domain/player/session.ts";
import type * as Operations from "../../src/domain/player/sessionOperations.ts";
import { setSessionScope } from "../../src/shared/api/client.ts";
import type { FooJeanOptions } from "../fake-api/fooJean/options.ts";
import { postsToSession } from "../fake-api/state.ts";
import { fakePlayer } from "./fakeSessionHarness.ts";

// The store and the listener store run for real against the fake player, in this process and over
// HTTP. Only the browser is stood in for: the document, `sessionStorage`, and an audio element that
// opens the stream it is given, so the fake counts it as a connection exactly as it counts a
// browser's.

export const ON_PLAYER = { id: null, role: null } as const;

export const FORMATS = ["opus"];

const realFetch = globalThis.fetch;
const realDocument = globalThis.document;
const realAudio = globalThis.Audio;
const realMediaError = globalThis.MediaError;

export class MemoryStorage implements Storage {
	readonly #items = new Map<string, string>();

	get length() {
		return this.#items.size;
	}

	clear() {
		this.#items.clear();
	}

	getItem(key: string) {
		return this.#items.get(key) ?? null;
	}

	key(index: number) {
		return [...this.#items.keys()][index] ?? null;
	}

	removeItem(key: string) {
		this.#items.delete(key);
	}

	setItem(key: string, value: string) {
		this.#items.set(key, String(value));
	}
}

const storedValueIn = (storage: Storage) => {
	const raw = storage.getItem(SESSION_KEY);
	return raw === null ? null : JSON.parse(raw);
};

// The figures a browser's `MediaError` carries, which the listener store reads on an `error`.
const MEDIA_ERROR = {
	MEDIA_ERR_ABORTED: 1,
	MEDIA_ERR_NETWORK: 2,
	MEDIA_ERR_DECODE: 3,
	MEDIA_ERR_SRC_NOT_SUPPORTED: 4,
};

interface ElementWorld {
	openStreams: () => number;
	pending: Set<Promise<unknown>>;
	played: string[];
}

let world: ElementWorld | null = null;

// The listener store keeps its element for the life of the module, so one made in an earlier case
// is the one a later case plays.
const elements: StreamingAudio[] = [];

const quietly = (pending: Set<Promise<unknown>>, work: Promise<unknown>) => {
	const tracked = work.finally(() => pending.delete(tracked));
	pending.add(tracked);
	return tracked;
};

// A browser's media element as far as the listener store can tell: `src`, `play()`, `pause()`,
// `removeAttribute("src")` with `load()`, and the events it dispatches. A browser fires `emptied`
// from `load()` once an element that had a resource lets it go; here that is once the fake has seen
// the socket close, or, for a case that holds it, once the case lets go itself. Chromium fires it
// while the player still holds the connection, which is what `closeLate()` stands in for.
export class StreamingAudio extends EventTarget {
	preload = "";
	autoplay = false;
	volume = 1;
	muted = false;
	hidden = false;
	currentTime = 0;
	paused = true;
	error: { code: number } | null = null;
	buffered = { length: 0, start: () => 0, end: () => 0 };
	onemptied: ((event: Event) => void) | null = null;

	#src = "";
	#connection: ClientRequest | null = null;
	#connectedTo = "";
	#holding = false;
	#closingLate = false;
	#held: (() => void)[] = [];

	constructor() {
		super();
		elements.push(this);
	}

	get src() {
		return this.#src;
	}

	set src(next: string) {
		this.#letGoOfConnection();
		this.#src = next;
	}

	removeAttribute(name: string) {
		if (name === "src") this.#src = "";
	}

	load() {
		this.#letGoOfConnection();
	}

	pause() {
		this.paused = true;
	}

	play(): Promise<void> {
		const at = world;
		if (!this.#src || !at)
			return Promise.reject(
				new DOMException(
					"The element has no supported sources.",
					"NotSupportedError",
				),
			);
		if (this.#connection && this.#connectedTo === this.#src) {
			this.paused = false;
			this.dispatchEvent(new Event("playing"));
			return Promise.resolve();
		}

		const src = this.#src;
		at.played.push(src);
		// A socket of its own, as a browser gives a media element, and dropped whole on a release.
		const connected = new Promise<void>((resolve) => {
			const connection = get(src, { agent: false }, (response) => {
				response.resume();
				if (this.#connection !== connection) return resolve();
				if (response.statusCode !== 200) {
					this.error = { code: MEDIA_ERROR.MEDIA_ERR_NETWORK };
					this.dispatchEvent(new Event("error"));
					return resolve();
				}
				this.paused = false;
				this.dispatchEvent(new Event("playing"));
				resolve();
			});
			connection.on("error", () => resolve());
			connection.on("close", () => resolve());
			this.#connection = connection;
			this.#connectedTo = src;
		});
		return quietly(at.pending, connected) as Promise<void>;
	}

	// The next release waits for `letGo()` rather than for the fake.
	holdLetGo() {
		this.#holding = true;
	}

	// The next release fires `emptied` at once and keeps its socket open until `letGo()`.
	closeLate() {
		this.#closingLate = true;
	}

	letGo() {
		this.#holding = false;
		const held = this.#held;
		this.#held = [];
		for (const release of held) release();
	}

	#letGoOfConnection() {
		const connection = this.#connection;
		const at = world;
		if (!connection || !at) return;
		this.#connection = null;
		this.#connectedTo = "";
		this.paused = true;

		const emptied = () => {
			const event = new Event("emptied");
			this.dispatchEvent(event);
			this.onemptied?.(event);
		};
		if (this.#closingLate) {
			this.#closingLate = false;
			this.#held.push(() => {
				connection.destroy();
				quietly(at.pending, seenClosedBy(at));
			});
			quietly(at.pending, Promise.resolve().then(emptied));
			return;
		}

		connection.destroy();
		if (this.#holding) {
			this.#held.push(emptied);
			return;
		}
		quietly(at.pending, seenClosedBy(at).then(emptied));
	}
}

const seenClosedBy = async (at: ElementWorld) => {
	for (let round = 0; at.openStreams() > 0; round += 1) {
		assert.ok(round < 500, "the fake never saw the stream close");
		await new Promise((resolve) => setImmediate(resolve));
	}
};

interface Gate {
	matches: (request: Request) => boolean;
	waiting: (() => void)[];
	open: boolean;
	count: number;
	arrived: () => void;
}

export interface Step {
	route: string;
	session: string | null;
	deviceId: string | null;
	ticket: string | null;
	body: Record<string, unknown> | null;
}

const ROUTES: Record<string, string> = {
	"POST /api/sessions": "create",
	"POST /api/stream/ticket": "ticket",
	"GET /api/stream": "stream",
	"POST /api/stream/leave": "leave",
	"GET /api/state": "poll",
	"GET /api/stream/timeline": "timeline",
};

type Fake = ReturnType<typeof fakePlayer>;

// `node:test`'s mocked `clearTimeout` removes whatever timer sits at the queue position the handle
// carries, and `mock.timers.reset()` leaves that position on every handle it drops. undici, which
// Node's `fetch` is built on, keeps its connection timers from one case to the next and clears them
// through the global `clearTimeout`, so a handle from an earlier case's clock takes a live timer of
// this one with it, the poll's interval among them. Only a handle this clock made is passed on.
const clearOnlyOwnTimers = () => {
	const own = new WeakSet<object>();
	const { setTimeout, setInterval, clearTimeout, clearInterval } = globalThis;
	const kept = <T extends object>(handle: T) => {
		own.add(handle);
		return handle;
	};
	const isOwn = (handle: unknown) =>
		typeof handle === "object" && handle !== null && own.has(handle);
	Object.assign(globalThis, {
		setTimeout: (...args: Parameters<typeof setTimeout>) =>
			kept(setTimeout(...args)),
		setInterval: (...args: Parameters<typeof setInterval>) =>
			kept(setInterval(...args)),
		clearTimeout: (handle: Parameters<typeof clearTimeout>[0]) => {
			if (isOwn(handle)) clearTimeout(handle);
		},
		clearInterval: (handle: Parameters<typeof clearInterval>[0]) => {
			if (isOwn(handle)) clearInterval(handle);
		},
	});
};

export function sessionStoreHarness() {
	const fake: Fake = fakePlayer();

	const begin = async (
		t: TestContext,
		{
			fooJean = {},
			reloading = false,
		}: {
			fooJean?: FooJeanOptions;
			// A page that has only just loaded: no poll yet, and no target handed to the listener.
			reloading?: boolean;
		} = {},
	) => {
		fake.fresh(fooJean);
		const origin = await originOf();

		const pending = new Set<Promise<unknown>>();
		const gates: Gate[] = [];
		const here: ElementWorld = {
			openStreams: () => fake.state.openStreams,
			pending,
			played: [],
		};
		world = here;

		globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
			const request =
				input instanceof Request ? input : new Request(input, init);
			const gate = gates.find((one) => one.open && one.matches(request));
			if (!gate) return quietly(pending, realFetch(request));
			gate.count += 1;
			gate.arrived();
			return new Promise<Response>((resolve, reject) => {
				gate.waiting.push(() => {
					quietly(pending, realFetch(request)).then(
						(answer) => resolve(answer as Response),
						reject,
					);
				});
			});
		}) as typeof fetch;

		globalThis.document = {
			visibilityState: "visible",
			hidden: false,
			addEventListener: () => {},
			removeEventListener: () => {},
			body: { appendChild: (child: unknown) => child },
		} as unknown as Document;
		globalThis.Audio = StreamingAudio as unknown as typeof Audio;
		globalThis.MediaError = MEDIA_ERROR as unknown as typeof MediaError;
		const storage = new MemoryStorage();
		Object.assign(globalThis, { sessionStorage: storage });

		mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
		clearOnlyOwnTimers();

		const settle = async () => {
			for (let idle = 0, round = 0; idle < 5; round += 1) {
				assert.ok(round < 5000, "the store never went quiet");
				await new Promise((resolve) => setImmediate(resolve));
				idle = pending.size === 0 ? idle + 1 : 0;
			}
		};

		// What `useListener`'s effect hands the listener store on a page that can stream.
		if (!reloading)
			configureListening({
				origin,
				formats: FORMATS,
				session: sessionSnapshot().id,
			});

		const queryClient = new QueryClient();
		const stopPoll = !reloading
			? startPlayerPoll(queryClient, origin)
			: () => {};

		t.after(async () => {
			for (const gate of gates) {
				gate.open = false;
				for (const release of gate.waiting.splice(0)) release();
			}
			for (const element of elements) element.letGo();
			commitSession(ON_PLAYER);
			configureListening(null);
			setSessionScope(null);
			await settle();
			stopPoll();
			queryClient.clear();
			mock.timers.reset();
			await settle();
			world = null;
			globalThis.fetch = realFetch;
			globalThis.document = realDocument;
			globalThis.Audio = realAudio;
			globalThis.MediaError = realMediaError;
			Reflect.deleteProperty(globalThis, "sessionStorage");
		});

		await settle();

		let rechecks = 0;
		const context = {
			origin,
			recheck: () => {
				rechecks += 1;
			},
			queryClient,
		};

		const steps = (from = 0): Step[] =>
			fake.state.requests.slice(from).flatMap((entry) => {
				const url = new URL(entry.path, "http://fake");
				const route = ROUTES[`${entry.method} ${url.pathname}`];
				if (!route) return [];
				return [
					{
						route,
						session: url.searchParams.get("session"),
						deviceId:
							url.searchParams.get("deviceId") ??
							(typeof entry.body?.deviceId === "string"
								? entry.body.deviceId
								: null),
						ticket: url.searchParams.get("ticket"),
						body: entry.body,
					},
				];
			});

		return {
			fake,
			storage,
			context,
			rechecks: () => rechecks,
			queryClient,
			settle,
			mark: () => fake.state.requests.length,
			steps,
			// Each step as `route` or `route session`, the player's own written as `player`.
			said: (from = 0, routes?: string[]) =>
				steps(from)
					.filter((one) => !routes || routes.includes(one.route))
					.map((one) =>
						one.route === "stream" || one.route === "create"
							? one.route
							: `${one.route} ${one.session ?? "player"}`,
					),
			leavesTo: (session: string, from = 0) =>
				postsToSession(
					fake.state.requests.slice(from),
					"/api/stream/leave",
					session,
				),
			stored: () => storedValueIn(storage),
			phase: () => listeningSnapshot().phase.kind,
			isListening: () => isListening(listeningSnapshot().phase),
			openStreams: () => fake.state.openStreams,
			played: () => [...here.played],
			element: () => elements.at(-1) ?? null,
			// Holds every request `matches` picks out, on this side of the wire, until `release`.
			hold: (matches: (request: Request) => boolean) => {
				let arrived: () => void = () => {};
				const reached = new Promise<void>((resolve) => {
					arrived = resolve;
				});
				const gate: Gate = {
					matches,
					waiting: [],
					open: true,
					count: 0,
					arrived,
				};
				gates.push(gate);
				return {
					reached,
					count: () => gate.count,
					release: () => {
						gate.open = false;
						for (const release of gate.waiting.splice(0)) release();
					},
				};
			},
			// Runs the store's own timers forward by `ms`, letting the network answer between steps.
			advance: async (ms: number) => {
				const STEP_MS = 100;
				for (let passed = 0; passed < ms; passed += STEP_MS) {
					mock.timers.tick(Math.min(STEP_MS, ms - passed));
					await settle();
				}
			},
			thisDevice: deviceId,
		};
	};

	// `fakeSessionHarness.ts` keeps the fake's address to itself, so it is read off a request it sends.
	const originOf = async () => {
		let seen = "";
		globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
			seen = new URL(input instanceof Request ? input.url : String(input))
				.origin;
			return realFetch(input, init);
		}) as typeof fetch;
		try {
			await fake.send("GET", "/status");
		} finally {
			globalThis.fetch = realFetch;
		}
		return seen;
	};

	return { fake, begin };
}

// Loaded rather than imported, so a module that does not load fails each case by name instead of
// the whole file at once.
export const loadOperations = (): Promise<typeof Operations> =>
	import("../../src/domain/player/sessionOperations.ts").catch(
		(error: unknown) =>
			new Proxy({} as typeof Operations, {
				get: (_, name) => {
					if (name === "then") return undefined;
					throw new Error(
						`sessionOperations.ts did not load, so ${String(name)} is out of reach`,
						{ cause: error },
					);
				},
			}),
	);

export const named = (path: string) => (request: Request) =>
	new URL(request.url).pathname === path;
