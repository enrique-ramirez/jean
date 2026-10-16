import { serveSearch } from "../../src/domain/track/searchChannel.ts";

type Listener = (event: Event) => void;

// A message between a page and its worker arrives as a task of its own, queued with the page's
// other tasks, so it is delivered through a channel rather than `setImmediate`, which would run it
// only once every task queued before it had run.
const asTask = (run: () => void) => {
	const { port1, port2 } = new MessageChannel();
	port1.onmessage = () => {
		port1.close();
		run();
	};
	port2.postMessage(null);
};

export interface StubWorker {
	readonly isTerminated: boolean;
	// What a worker whose script threw looks like to the page: an `error` event, and nothing more
	// from it after.
	fail: () => void;
	hold: () => void;
	release: () => void;
}

export function installStubWorker() {
	const spawned: StubWorker[] = [];
	const previous = (globalThis as { Worker?: unknown }).Worker;

	class Worker implements StubWorker {
		isTerminated = false;
		#isDead = false;
		#isHolding = false;
		#held: (() => void)[] = [];
		#page = new Map<string, Set<Listener>>();
		#inside = new Set<Listener>();

		constructor() {
			spawned.push(this);
			serveSearch({
				postMessage: (message, transfer) => {
					const data = structuredClone(message, { transfer });
					const send = () => this.#deliver("message", data);
					if (this.#isHolding) this.#held.push(send);
					else send();
				},
				addEventListener: (type, listener) => {
					if (type === "message") this.#inside.add(listener as Listener);
				},
			});
		}

		#deliver(type: string, data: unknown) {
			asTask(() => {
				if (this.#isDead) return;
				for (const listener of this.#page.get(type) ?? [])
					listener(new MessageEvent(type, { data }));
			});
		}

		postMessage(
			message: unknown,
			options?: Transferable[] | StructuredSerializeOptions,
		) {
			const transfer = Array.isArray(options)
				? options
				: (options?.transfer ?? []);
			const data = structuredClone(message, { transfer });
			asTask(() => {
				if (this.#isDead) return;
				for (const listener of this.#inside)
					listener(new MessageEvent("message", { data }));
			});
		}

		addEventListener(type: string, listener: Listener) {
			const listeners = this.#page.get(type) ?? new Set<Listener>();
			listeners.add(listener);
			this.#page.set(type, listeners);
		}

		removeEventListener(type: string, listener: Listener) {
			this.#page.get(type)?.delete(listener);
		}

		terminate() {
			this.isTerminated = true;
			this.#isDead = true;
		}

		fail() {
			this.#isDead = true;
			for (const listener of this.#page.get("error") ?? [])
				listener(new Event("error"));
		}

		hold() {
			this.#isHolding = true;
		}

		release() {
			this.#isHolding = false;
			for (const send of this.#held.splice(0)) send();
		}
	}

	Object.assign(globalThis, { Worker });
	return {
		spawned,
		uninstall: () => Object.assign(globalThis, { Worker: previous }),
	};
}
