import { type JlibColumn, jlibColumn } from "@/shared/api/jlib";
import { encodedSnapshot } from "@/shared/api/jlibEncode";
import { TRACK_EXPRESSIONS } from "./fields";
import type { LibraryColumns } from "./libraryColumns";
import type { KeepNote, StoredEvent } from "./libraryStore";
import type {
	FromWorker,
	SearchPort,
	StoredCopy,
	ToWorker,
} from "./searchChannel";
import {
	type AnswerTo,
	answerOf,
	type SearchCore,
	type SearchQuestion,
	searchCoreOver,
} from "./searchCore";

const STORE_ANSWER_MS = 4_000;

const ASK_ANSWER_MS = 10_000;

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
	mirror: (columns: LibraryColumns) => void;
	version: () => number;
	ask: <Question extends SearchQuestion>(
		question: Question,
	) => Promise<AnswerTo<Question> | null>;
}

interface Waiting {
	question: SearchQuestion;
	resolve: (answer: unknown) => void;
	timer: ReturnType<typeof setTimeout> | undefined;
}

function handedOverBytes(columns: LibraryColumns): ArrayBuffer | null {
	if (!columns.fields.every((column) => column.isLoaded)) return null;

	const none = (): JlibColumn =>
		jlibColumn(
			new Uint8Array(columns.trackCount),
			{ count: 1, of: () => "", appended: [] },
			{ distinct: 1, hasUnresolved: false, allUnresolved: false },
		);
	return encodedSnapshot({
		structure: 0,
		revision: 0,
		snapshotId: "0000000000000000",
		trackCount: columns.trackCount,
		columns: TRACK_EXPRESSIONS.map((name, field) => ({
			name,
			column: columns.fields[field],
		})),
		spine: { directory: none(), filename: none(), subsong: none() },
	});
}

export function searchClient(
	first: SearchPort,
	spawn?: () => SearchPort,
): SearchClient {
	let port = first;
	let version = 0;
	let asked = 0;
	let isGone = false;
	let isRespawned = false;
	let outgrown: (() => void) | null = null;
	let mirrored: LibraryColumns | null = null;
	let ownCore: SearchCore | null = null;
	const waiting = new Map<number, Waiting>();
	const storing = new Map<number, (answer: unknown) => void>();

	const answeredHere = (question: SearchQuestion) => {
		if (!mirrored) return null;
		try {
			ownCore ??= searchCoreOver(mirrored);
			return answerOf(ownCore, question);
		} catch {
			return null;
		}
	};

	const workerGone = () => {
		if (isGone) return;
		isGone = true;
		for (const { question, resolve, timer } of waiting.values()) {
			clearTimeout(timer);
			resolve(answeredHere(question));
		}
		waiting.clear();
		for (const resolve of storing.values()) resolve(null);
		storing.clear();
	};

	const send = (id: number, held: Waiting) => {
		const sentTo = port;
		held.timer = setTimeout(() => failed(sentTo), ASK_ANSWER_MS);
		sentTo.postMessage(
			{ type: "ask", id, question: held.question } satisfies ToWorker,
			[],
		);
	};

	const failed = (from: SearchPort) => {
		if (from !== port || isGone) return;
		from.terminate?.();
		const bytes = mirrored && handedOverBytes(mirrored);
		if (isRespawned || !spawn || !bytes) return workerGone();

		isRespawned = true;
		try {
			port = spawn();
			attach(port);
			port.postMessage({ type: "load", bytes } satisfies ToWorker, [bytes]);
		} catch {
			return workerGone();
		}
		for (const resolve of storing.values()) resolve(null);
		storing.clear();
		for (const [id, held] of waiting) {
			clearTimeout(held.timer);
			send(id, held);
		}
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

	const replaced = () => {
		version += 1;
		for (const { resolve, timer } of waiting.values()) {
			clearTimeout(timer);
			resolve(null);
		}
		waiting.clear();
	};

	function attach(end: SearchPort) {
		end.addEventListener("error", () => failed(end));
		end.addEventListener("messageerror", () => failed(end));
		end.addEventListener("message", ({ data }: MessageEvent<FromWorker>) => {
			if (end !== port) return;
			if (data.type === "outgrown") return outgrown?.();
			if (data.type === "stored" || data.type === "restored") {
				const resolve = storing.get(data.id);
				if (!resolve) return;
				storing.delete(data.id);
				resolve(data.type === "stored" ? data.copy : data.events);
				return;
			}
			const held = waiting.get(data.id);
			if (!held) return;
			waiting.delete(data.id);
			clearTimeout(held.timer);
			held.resolve(data.answer);
		});
	}
	attach(port);

	return {
		version: () => version,
		load: (bytes, keep) => {
			replaced();
			port.postMessage({ type: "load", bytes, keep } satisfies ToWorker, [
				bytes,
			]);
		},
		patch: (bytes, keep) => {
			replaced();
			port.postMessage({ type: "patch", bytes, keep } satisfies ToWorker, [
				bytes,
			]);
		},
		splice: (bytes, keep) => {
			replaced();
			port.postMessage({ type: "splice", bytes, keep } satisfies ToWorker, [
				bytes,
			]);
		},
		part: (bytes, patches, keep) => {
			replaced();
			port.postMessage(
				{ type: "part", bytes, patches, keep } satisfies ToWorker,
				[bytes, ...patches],
			);
		},
		settle: () => {
			replaced();
			port.postMessage({ type: "settle" } satisfies ToWorker, []);
		},
		stored: () => askStore<StoredCopy>({ type: "stored" }),
		restore: async (rekey) => {
			const events = await askStore<StoredEvent[] | null>({
				type: "restore",
				rekey,
			});
			if (events) replaced();
			return events;
		},
		forget: () => port.postMessage({ type: "forget" } satisfies ToWorker, []),
		onOutgrown: (listener) => {
			outgrown = listener;
		},
		mirror: (columns) => {
			if (columns === mirrored) return;
			ownCore =
				ownCore && ownCore.columns.load === columns.load
					? { ...ownCore, columns }
					: null;
			mirrored = columns;
		},
		ask: <Question extends SearchQuestion>(question: Question) =>
			new Promise<AnswerTo<Question> | null>((resolve) => {
				if (isGone)
					return resolve(answeredHere(question) as AnswerTo<Question>);
				asked += 1;
				const held: Waiting = {
					question,
					timer: undefined,
					resolve: (answer) => resolve(answer as AnswerTo<Question> | null),
				};
				waiting.set(asked, held);
				send(asked, held);
			}),
	};
}
