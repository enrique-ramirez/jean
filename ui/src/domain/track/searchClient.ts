import type { KeepNote, StoredEvent } from "./libraryStore";
import type {
	FromWorker,
	SearchPort,
	StoredCopy,
	ToWorker,
} from "./searchChannel";

const STORE_ANSWER_MS = 4_000;

export interface SearchClient {
	load: (bytes: ArrayBuffer, keep?: KeepNote) => void;
	patch: (bytes: ArrayBuffer, keep?: KeepNote) => void;
	splice: (bytes: ArrayBuffer, keep?: KeepNote) => void;
	part: (bytes: ArrayBuffer, patches: ArrayBuffer[], keep?: KeepNote) => void;
	settle: () => void;
	stored: () => Promise<StoredCopy | null>;
	restore: (rekey?: KeepNote) => Promise<StoredEvent[] | null>;
	forget: () => void;
	onOutgrown: (listener: () => void) => void;
}

export function searchClient(port: SearchPort): SearchClient {
	let asked = 0;
	let isGone = false;
	let outgrown: (() => void) | null = null;
	const storing = new Map<number, (answer: unknown) => void>();

	const workerGone = () => {
		if (isGone) return;
		isGone = true;
		port.terminate?.();
		for (const resolve of storing.values()) resolve(null);
		storing.clear();
	};

	const askStore = <Answer>(message: {
		type: "stored" | "restore";
		rekey?: KeepNote;
	}): Promise<Answer | null> =>
		new Promise((resolve) => {
			if (isGone) return resolve(null);
			asked += 1;
			const id = asked;
			const timer = setTimeout(() => {
				storing.delete(id);
				resolve(null);
			}, STORE_ANSWER_MS);
			storing.set(id, (answer) => {
				clearTimeout(timer);
				resolve(answer as Answer);
			});
			port.postMessage({ ...message, id } satisfies ToWorker, []);
		});

	port.addEventListener("error", workerGone);
	port.addEventListener("messageerror", workerGone);
	port.addEventListener("message", ({ data }: MessageEvent<FromWorker>) => {
		if (data.type === "outgrown") return outgrown?.();
		const resolve = storing.get(data.id);
		if (!resolve) return;
		storing.delete(data.id);
		resolve(data.type === "stored" ? data.copy : data.events);
	});

	return {
		load: (bytes, keep) =>
			port.postMessage({ type: "load", bytes, keep } satisfies ToWorker, [
				bytes,
			]),
		patch: (bytes, keep) =>
			port.postMessage({ type: "patch", bytes, keep } satisfies ToWorker, [
				bytes,
			]),
		splice: (bytes, keep) =>
			port.postMessage({ type: "splice", bytes, keep } satisfies ToWorker, [
				bytes,
			]),
		part: (bytes, patches, keep) =>
			port.postMessage(
				{ type: "part", bytes, patches, keep } satisfies ToWorker,
				[bytes, ...patches],
			),
		settle: () => port.postMessage({ type: "settle" } satisfies ToWorker, []),
		stored: () => askStore<StoredCopy>({ type: "stored" }),
		restore: (rekey) =>
			askStore<StoredEvent[] | null>({ type: "restore", rekey }),
		forget: () => port.postMessage({ type: "forget" } satisfies ToWorker, []),
		onOutgrown: (listener) => {
			outgrown = listener;
		},
	};
}
