import { rekeyedSnapshotBytes } from "./libraryRekey";
import { replayedLibrary } from "./libraryReplay";
import { withSettledLatePart } from "./librarySnapshot";
import {
	type KeepNote,
	MAX_KEPT_CHANGES,
	type StoredEvent,
	type StoredLibrary,
} from "./libraryStore";
import type { LibraryStore } from "./libraryStoreDb";
import {
	answerOf,
	partedSearchCore,
	patchedSearchCore,
	type SearchCore,
	type SearchQuestion,
	searchCoreOf,
	splicedSearchCore,
} from "./searchCore";

export interface SearchPort {
	postMessage: (message: unknown, transfer: Transferable[]) => void;
	addEventListener: (
		type: "message" | "error" | "messageerror",
		listener: (event: MessageEvent) => void,
	) => void;
	terminate?: () => void;
}

export type ToWorker =
	| { type: "load"; bytes: ArrayBuffer; keep?: KeepNote }
	| { type: "patch"; bytes: ArrayBuffer; keep?: KeepNote }
	| { type: "splice"; bytes: ArrayBuffer; keep?: KeepNote }
	| {
			type: "part";
			bytes: ArrayBuffer;
			patches: ArrayBuffer[];
			keep?: KeepNote;
	  }
	| { type: "settle" }
	| { type: "ask"; id: number; question: SearchQuestion }
	| { type: "stored"; id: number }
	| { type: "restore"; id: number; rekey?: KeepNote }
	| { type: "forget" };

export interface StoredCopy {
	build: string;
	stored: StoredLibrary | null;
}

export type FromWorker =
	| { type: "answer"; id: number; answer: unknown }
	| { type: "stored"; id: number; copy: StoredCopy }
	| { type: "restored"; id: number; events: StoredEvent[] | null }
	| { type: "outgrown" };

const WARM_SLICE_MS = 8;

function warmBetweenMessages(core: SearchCore, isCurrent: () => boolean) {
	const step = () => {
		if (!isCurrent()) return;
		const deadline = performance.now() + WARM_SLICE_MS;
		const isDone = core.folded.warm(
			core.columns,
			() => performance.now() < deadline,
		);
		if (!isDone) setTimeout(step, 0);
	};
	setTimeout(step, 0);
}

const copied = ({ kind, bytes }: StoredEvent): StoredEvent => ({
	kind,
	bytes: bytes.slice(0),
});

function replayedCore(events: readonly StoredEvent[]): SearchCore | null {
	let core: SearchCore | null = null;
	for (let at = 0; at < events.length; at += 1) {
		const { kind, bytes } = events[at];
		const copy = bytes.slice(0);
		if (kind === "load") core = searchCoreOf(copy);
		else if (kind === "delta") core = core && patchedSearchCore(core, copy);
		else if (kind === "splice") core = core && splicedSearchCore(core, copy);
		else if (kind === "part") {
			const patches: ArrayBuffer[] = [];
			while (events[at + 1]?.kind === "partPatch") {
				at += 1;
				patches.push(events[at].bytes.slice(0));
			}
			core = core && partedSearchCore(core, copy, patches);
		}
		if (!core) return null;
	}
	return core;
}

function rekeyedEvents(
	events: readonly StoredEvent[],
	pair: KeepNote,
): StoredEvent[] | null {
	const held = replayedLibrary(events);
	return held
		? [{ kind: "load", bytes: rekeyedSnapshotBytes(held, pair) }]
		: null;
}

const isChange = ({ kind }: StoredEvent) =>
	kind === "delta" || kind === "splice";

export function serveSearch(port: SearchPort, store?: LibraryStore) {
	let core: SearchCore | null = null;
	let epoch = 0;
	let keptChanges = 0;

	const answer = (id: number, answered: unknown) =>
		port.postMessage(
			{ type: "answer", id, answer: answered } satisfies FromWorker,
			[],
		);

	const announceOutgrowth = () => {
		if (keptChanges > MAX_KEPT_CHANGES)
			port.postMessage({ type: "outgrown" } satisfies FromWorker, []);
	};

	const restored = async (id: number, rekey: KeepNote | undefined) => {
		const began = epoch;
		const stored = (await store?.restore()) ?? null;
		let events = stored;
		let rebuilt: SearchCore | null = null;
		try {
			events = stored && rekey ? rekeyedEvents(stored, rekey) : stored;
			rebuilt = events && replayedCore(events);
		} catch {
			rebuilt = null;
		}
		const isCurrent = epoch === began;

		const kept = rebuilt && isCurrent ? (events as StoredEvent[]) : null;
		if (rebuilt && kept) {
			core = rebuilt;
			keptChanges = rekey ? 0 : kept.filter(isChange).length;
			if (rekey) store?.keep(kept.map(copied), rekey);
		}
		port.postMessage(
			{ type: "restored", id, events: kept } satisfies FromWorker,
			kept ? kept.map(({ bytes }) => bytes) : [],
		);
		if (rebuilt && kept) {
			warmed(rebuilt);
			announceOutgrowth();
		}
	};

	const warmed = (fresh: SearchCore) =>
		warmBetweenMessages(fresh, () => core?.folded === fresh.folded);

	const keep = (note: KeepNote | undefined, events: StoredEvent[]) => {
		if (!note) return;
		store?.keep(events, note);
		keptChanges += events.filter(isChange).length;
		announceOutgrowth();
	};

	port.addEventListener("message", ({ data }: MessageEvent<ToWorker>) => {
		switch (data.type) {
			case "load":
				epoch += 1;
				keptChanges = 0;
				core = searchCoreOf(data.bytes);
				warmed(core);
				keep(data.keep, [{ kind: "load", bytes: data.bytes }]);
				return;
			case "patch":
				epoch += 1;
				core = core && patchedSearchCore(core, data.bytes);
				keep(data.keep, [{ kind: "delta", bytes: data.bytes }]);
				return;
			case "splice":
				epoch += 1;
				core = core && splicedSearchCore(core, data.bytes);
				if (core) warmed(core);
				keep(data.keep, [{ kind: "splice", bytes: data.bytes }]);
				return;
			case "part":
				epoch += 1;
				core = core && partedSearchCore(core, data.bytes, data.patches);
				keep(data.keep, [
					{ kind: "part", bytes: data.bytes },
					...data.patches.map((bytes) => ({
						kind: "partPatch" as const,
						bytes,
					})),
				]);
				return;
			case "settle":
				epoch += 1;
				core = core && { ...core, columns: withSettledLatePart(core.columns) };
				return;
			case "ask":
				answer(data.id, core ? answerOf(core, data.question) : null);
				return;
			case "stored":
				void (store?.stored() ?? Promise.resolve(null)).then((stored) =>
					port.postMessage(
						{
							type: "stored",
							id: data.id,
							copy: { build: store?.build ?? "", stored },
						} satisfies FromWorker,
						[],
					),
				);
				return;
			case "restore":
				void restored(data.id, data.rekey);
				return;
			case "forget":
				void store?.forget();
		}
	});
}
