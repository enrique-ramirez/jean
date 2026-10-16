import type {
	KeepNote,
	LibraryPair,
	StoredEvent,
	StoredKind,
	StoredLibrary,
} from "./libraryStore";

const DATABASE = "jean-library";
const STORE = "library";
const META = "meta";

const CHUNK_BYTES = 4 * 1024 * 1024;

const OPEN_GIVE_UP_MS = 500;

// Another page holding a connection open keeps a delete pending, and that page closes it as soon as
// it hears; one that never does is waited on no longer than this.
const DELETE_GIVE_UP_MS = 5_000;

interface Meta extends LibraryPair {
	generation: string;
	events: number;
	declaration: readonly string[];
	format: number;
	apiVersion: number;
	build: string;
}

interface Chunk {
	seq: number;
	kind: StoredKind;
	index: number;
	chunks: number;
	size: number;
	bytes: ArrayBuffer;
}

interface Writer {
	generation: string;
	events: number;
}

// `crypto.randomUUID` needs a secure context, and Jean is also served over plain HTTP on a LAN.
const newGeneration = () =>
	`${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;

const padded = (n: number, width: number) => String(n).padStart(width, "0");

const chunkKey = (generation: string, seq: number, index: number) =>
	`${generation}/${padded(seq, 8)}/${padded(index, 5)}`;

const inGeneration = (generation: string) =>
	IDBKeyRange.bound(`${generation}/`, `${generation}/￿`);

const settled = (transaction: IDBTransaction) =>
	new Promise<void>((resolve, reject) => {
		transaction.oncomplete = () => resolve();
		transaction.onabort = () =>
			reject(transaction.error ?? new Error("aborted"));
		transaction.onerror = () => reject(transaction.error);
	});

const answered = <T>(request: IDBRequest<T>) =>
	new Promise<T>((resolve, reject) => {
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});

const openDatabase = () =>
	new Promise<IDBDatabase>((resolve, reject) => {
		const request = indexedDB.open(DATABASE, 1);
		let isGivenUp = false;
		const timer = setTimeout(() => {
			isGivenUp = true;
			reject(new Error("the open did not answer"));
		}, OPEN_GIVE_UP_MS);
		request.onupgradeneeded = () => request.result.createObjectStore(STORE);
		request.onsuccess = () => {
			clearTimeout(timer);
			// A connection that arrives after the page stopped waiting has no one to close it.
			if (isGivenUp) request.result.close();
			else resolve(request.result);
		};
		request.onerror = () => {
			clearTimeout(timer);
			reject(request.error);
		};
		request.onblocked = () => reject(new Error("blocked"));
	});

const metaIsWhole = (meta: unknown): meta is Meta => {
	const m = meta as Meta | undefined;
	return (
		!!m &&
		typeof m.snapshotId === "string" &&
		typeof m.generation === "string" &&
		typeof m.events === "number" &&
		Array.isArray(m.declaration) &&
		typeof m.format === "number" &&
		typeof m.apiVersion === "number" &&
		typeof m.build === "string" &&
		typeof m.trackCount === "number" &&
		typeof m.structure === "number" &&
		typeof m.revision === "number"
	);
};

const storedOf = (meta: Meta): StoredLibrary => ({
	key: {
		declaration: meta.declaration,
		format: meta.format,
		apiVersion: meta.apiVersion,
		build: meta.build,
	},
	snapshotId: meta.snapshotId,
	trackCount: meta.trackCount,
	structure: meta.structure,
	revision: meta.revision,
});

export interface LibraryStore {
	build: string;
	keep: (events: StoredEvent[], note: KeepNote) => void;
	stored: () => Promise<StoredLibrary | null>;
	restore: () => Promise<StoredEvent[] | null>;
	forget: () => Promise<void>;
}

export function libraryStore(build: string): LibraryStore {
	let database: Promise<IDBDatabase> | null = null;
	let writer: Writer | null = null;
	let queue: Promise<unknown> = Promise.resolve();

	const opened = () => {
		database ??= openDatabase().then(
			(db) => {
				// Another page deleting the database waits for every connection to close.
				db.onversionchange = () => {
					db.close();
					database = null;
					writer = null;
				};
				return db;
			},
			(error) => {
				database = null;
				throw error;
			},
		);
		return database;
	};

	const closed = async () => {
		const held = database;
		database = null;
		(await held?.catch(() => null))?.close();
	};

	const enqueue = <T>(job: () => Promise<T>, otherwise: T): Promise<T> => {
		const run = queue.then(job, job).catch(() => otherwise);
		queue = run;
		return run;
	};

	const writeEvent = async (
		db: IDBDatabase,
		generation: string,
		seq: number,
		event: StoredEvent,
	) => {
		const size = event.bytes.byteLength;
		const chunks = Math.max(1, Math.ceil(size / CHUNK_BYTES));
		for (let index = 0; index < chunks; index += 1) {
			const transaction = db.transaction(STORE, "readwrite");
			const record: Chunk = {
				seq,
				kind: event.kind,
				index,
				chunks,
				size,
				bytes: event.bytes.slice(
					index * CHUNK_BYTES,
					(index + 1) * CHUNK_BYTES,
				),
			};
			transaction
				.objectStore(STORE)
				.put(record, chunkKey(generation, seq, index));
			await settled(transaction);
		}
	};

	const commit = async (db: IDBDatabase, held: Writer, note: KeepNote) => {
		const meta: Meta = {
			generation: held.generation,
			events: held.events,
			declaration: note.declaration,
			format: note.format,
			apiVersion: note.apiVersion,
			build,
			snapshotId: note.snapshotId,
			trackCount: note.trackCount,
			structure: note.structure,
			revision: note.revision,
		};

		const transaction = db.transaction(STORE, "readwrite");
		const objects = transaction.objectStore(STORE);
		const settling = settled(transaction);
		const first = objects.get(chunkKey(held.generation, 0, 0));
		first.onsuccess = () => {
			if (first.result === undefined) return transaction.abort();
			objects.put(meta, META);
			const cursor = objects.openKeyCursor();
			cursor.onsuccess = () => {
				const at = cursor.result;
				if (!at) return;
				const key = String(at.key);
				if (key !== META && !key.startsWith(`${held.generation}/`))
					objects.delete(at.key);
				at.continue();
			};
		};
		await settling;
	};

	const dropEverything = async () => {
		writer = null;
		await closed();
		await new Promise<void>((resolve) => {
			// A blocked delete is still pending and finishes when the other connections close.
			const timer = setTimeout(resolve, DELETE_GIVE_UP_MS);
			const done = () => {
				clearTimeout(timer);
				resolve();
			};
			const request = indexedDB.deleteDatabase(DATABASE);
			request.onsuccess = done;
			request.onerror = done;
		});
	};

	const metaOf = async (db: IDBDatabase) => {
		const meta = await answered(
			db.transaction(STORE, "readonly").objectStore(STORE).get(META),
		);
		return metaIsWhole(meta) ? meta : null;
	};

	const keepEvents = async (events: StoredEvent[], note: KeepNote) => {
		if (events[0].kind === "load")
			writer = { generation: newGeneration(), events: 0 };
		const held = writer;
		if (!held) return;

		try {
			const db = await opened();
			for (const event of events) {
				await writeEvent(db, held.generation, held.events, event);
				held.events += 1;
			}
			if (note.isWhole) await commit(db, held, note);
		} catch {
			if (writer === held) writer = null;
		}
	};

	return {
		build,

		keep: (events, note) => {
			if (events.length === 0) return;
			void enqueue(() => keepEvents(events, note), undefined);
		},

		stored: () =>
			enqueue(async () => {
				const meta = await metaOf(await opened());
				return meta ? storedOf(meta) : null;
			}, null),

		restore: () =>
			enqueue(async () => {
				const db = await opened();
				const meta = await metaOf(db);
				if (!meta) return null;

				const events: StoredEvent[] = [];
				const chunksOf: number[] = [];
				let filling: Uint8Array | null = null;
				let filled = 0;

				const take = (chunk: Chunk) => {
					if (chunk.index === 0) {
						if (chunksOf.length !== events.length) return "unreadable";
						if (events.length > 0 && filled !== chunksOf[events.length - 1])
							return "unreadable";
						filling = new Uint8Array(chunk.size);
						events.push({
							kind: chunk.kind,
							bytes: filling.buffer as ArrayBuffer,
						});
						chunksOf.push(chunk.chunks);
						filled = 0;
					}
					if (!filling || chunk.seq !== events.length - 1) return "unreadable";
					if (chunk.index >= chunksOf[events.length - 1]) return "left over";
					if (chunk.index !== filled) return "unreadable";

					const bytes = new Uint8Array(chunk.bytes);
					const at = chunk.index * CHUNK_BYTES;
					if (at + bytes.length > filling.length) return "unreadable";
					filling.set(bytes, at);
					filled += 1;
					return "taken";
				};

				const transaction = db.transaction(STORE, "readonly");
				const cursor = transaction
					.objectStore(STORE)
					.openCursor(inGeneration(meta.generation));
				const isRead = await new Promise<boolean>((resolve) => {
					cursor.onsuccess = () => {
						try {
							const at = cursor.result;
							if (!at) return resolve(true);
							const chunk = at.value as Chunk;
							if (chunk.seq >= meta.events) return resolve(true);
							if (take(chunk) === "unreadable") return resolve(false);
							at.continue();
						} catch {
							resolve(false);
						}
					};
					cursor.onerror = () => resolve(false);
					transaction.onabort = () => resolve(false);
				});
				if (!isRead || events.length !== meta.events) return null;
				if (filled !== chunksOf[chunksOf.length - 1]) return null;

				writer = { generation: meta.generation, events: meta.events };
				return events;
			}, null),

		forget: () => enqueue(dropEverything, undefined),
	};
}
