// Everything here is serialised into the page by Playwright, so each function carries no reference
// to anything outside its own body.

export interface PagePerf {
	// The longest gap between two turns of a zero-delay timer since `reset`: the main thread was busy
	// for that long. Every engine has it; it includes the timer's own few milliseconds of clamping.
	stallMs: () => number;
	// The longest `longtask` entry since `reset`, or null where the engine has no such observer.
	longTaskMs: () => number | null;
	reset: () => void;
	firstRowAt: number | null;
	// Runs `callback` after the next frame has painted: a message queued from a frame callback is
	// delivered once that frame is on screen.
	afterPaint: (callback: () => void) => void;
	keystroke: Promise<number> | null;
	marks: Marks;
}

interface Marks {
	rowInDomAt: number | null;
	restoreAskedAt: number | null;
	restoredAt: number | null;
	lateShownAt: number | null;
	stateAnswers: { at: number; structure: string | null }[];
	stallAtFirstRow: number | null;
	storeWindow: {
		openedAt: number | null;
		closedAt: number | null;
		stallMs: number;
	};
}

type Host = { __perf: PagePerf };

export function installProbes() {
	// The default buffer holds 250 entries, which a screenful of covers fills before the page is read.
	performance.setResourceTimingBufferSize(10_000);
	let stall = 0;
	let longTask = 0;
	let last = performance.now();
	const storeWindow: Marks["storeWindow"] = {
		openedAt: null,
		closedAt: null,
		stallMs: 0,
	};
	const tick = () => {
		const now = performance.now();
		if (now - last > stall) stall = now - last;
		if (storeWindow.openedAt !== null && storeWindow.closedAt === null) {
			const gap = now - Math.max(last, storeWindow.openedAt);
			if (gap > storeWindow.stallMs) storeWindow.stallMs = gap;
		}
		last = now;
		setTimeout(tick, 0);
	};
	tick();

	// Firefox and WebKit accept the call and never deliver an entry, so support is asked for.
	const hasLongTasks =
		PerformanceObserver.supportedEntryTypes?.includes("longtask") === true;
	if (hasLongTasks)
		new PerformanceObserver((list) => {
			for (const entry of list.getEntries())
				if (entry.duration > longTask) longTask = entry.duration;
		}).observe({ type: "longtask" });

	const marks: Marks = {
		rowInDomAt: null,
		restoreAskedAt: null,
		restoredAt: null,
		lateShownAt: null,
		stateAnswers: [],
		stallAtFirstRow: null,
		storeWindow,
	};

	// An IndexedDB read from here is queued behind the worker's writes.
	const STORE_POLL_MS = 50;
	const watchStore = () => {
		storeWindow.openedAt = performance.now();
		const opening = indexedDB.open("jean-library", 1);
		opening.onupgradeneeded = () => opening.result.createObjectStore("library");
		opening.onsuccess = () => {
			const db = opening.result;
			const look = () => {
				const read = db
					.transaction("library")
					.objectStore("library")
					.get("meta");
				read.onsuccess = () => {
					if (read.result === undefined)
						return void setTimeout(look, STORE_POLL_MS);
					storeWindow.closedAt = performance.now();
					db.close();
				};
				read.onerror = () => {
					storeWindow.closedAt = performance.now();
					db.close();
				};
			};
			look();
		};
	};

	const PageWorker = globalThis.Worker;
	globalThis.Worker = class extends PageWorker {
		constructor(url: string | URL, options?: WorkerOptions) {
			super(url, options);
			this.addEventListener("message", ({ data }: MessageEvent) => {
				if (data?.type === "restored") marks.restoredAt ??= performance.now();
			});
		}

		override postMessage(
			message: unknown,
			transfer?: Transferable[] | StructuredSerializeOptions,
		) {
			if ((message as { type?: string } | null)?.type === "restore")
				marks.restoreAskedAt ??= performance.now();
			super.postMessage(message, transfer as StructuredSerializeOptions);
		}
	} as unknown as typeof Worker;

	const pageFetch = globalThis.fetch;
	globalThis.fetch = async (input, init) => {
		const answer = await pageFetch.call(globalThis, input, init);
		const url =
			typeof input === "string"
				? input
				: input instanceof URL
					? input.href
					: input.url;
		if (
			url.includes("/library/export") &&
			!url.includes("spine=false") &&
			storeWindow.openedAt === null
		)
			watchStore();
		if (url.includes("/api/state")) {
			if (answer.status !== 200)
				marks.stateAnswers.push({ at: performance.now(), structure: null });
			else
				void answer
					.clone()
					.text()
					.then((text) => {
						const found =
							/"library"\s*:\s*\{[^}]*?"structure"\s*:\s*(\d+)/.exec(text);
						marks.stateAnswers.push({
							at: performance.now(),
							structure: found?.[1] ?? null,
						});
					});
		}
		return answer;
	};

	addEventListener("pagehide", () =>
		sessionStorage.setItem("perf.pagehideAt", String(Date.now())),
	);

	const perf: PagePerf = {
		firstRowAt: null,
		keystroke: null,
		marks,
		afterPaint: (callback) =>
			requestAnimationFrame(() => {
				const channel = new MessageChannel();
				channel.port1.onmessage = () => callback();
				channel.port2.postMessage(null);
			}),
		stallMs: () => stall,
		longTaskMs: () => (hasLongTasks ? longTask : null),
		reset: () => {
			stall = 0;
			longTask = 0;
			last = performance.now();
		},
	};
	(globalThis as unknown as Host).__perf = perf;

	const watching = new MutationObserver(() => {
		if (!document.querySelector("[data-row]")) return;
		watching.disconnect();
		marks.rowInDomAt = performance.now();
		perf.afterPaint(() => {
			perf.firstRowAt = performance.now();
			marks.stallAtFirstRow = stall;
			const isBusy = () =>
				document.querySelector('[data-row][aria-busy="true"]');
			if (!isBusy()) {
				marks.lateShownAt = perf.firstRowAt;
				return;
			}
			const unbusy = new MutationObserver(() => {
				if (isBusy()) return;
				unbusy.disconnect();
				perf.afterPaint(() => {
					marks.lateShownAt = performance.now();
				});
			});
			unbusy.observe(document, {
				subtree: true,
				childList: true,
				attributes: true,
				attributeFilter: ["aria-busy"],
			});
		});
	});
	watching.observe(document, { subtree: true, childList: true });
}

export const resetProbes = () => (globalThis as unknown as Host).__perf.reset();

export const readProbes = () => {
	const perf = (globalThis as unknown as Host).__perf;
	return { stallMs: perf.stallMs(), longTaskMs: perf.longTaskMs() };
};

export const lateShownAt = () =>
	(globalThis as unknown as Host).__perf.marks.lateShownAt;

export function readTimeline() {
	const { marks, firstRowAt: painted } = (globalThis as unknown as Host).__perf;
	const [navigation] = performance.getEntriesByType(
		"navigation",
	) as PerformanceNavigationTiming[];
	const resources = performance.getEntriesByType(
		"resource",
	) as PerformanceResourceTiming[];
	const span = (entry: PerformanceResourceTiming | undefined) =>
		entry ? { start: entry.startTime, end: entry.responseEnd } : null;
	const exportParts = resources.filter((entry) =>
		entry.name.includes("/library/export"),
	);
	const isLate = (entry: PerformanceResourceTiming) =>
		entry.name.includes("only=") && entry.name.includes("spine=false");
	return {
		timeOrigin: performance.timeOrigin,
		pagehideEpoch: Number(sessionStorage.getItem("perf.pagehideAt")) || null,
		responseStart: navigation?.responseStart ?? null,
		domContentLoaded: navigation?.domContentLoadedEventEnd ?? null,
		stateAsked:
			resources.find((entry) => entry.name.includes("/api/state"))?.startTime ??
			null,
		restoreAsked: marks.restoreAskedAt,
		restored: marks.restoredAt,
		firstExport: span(exportParts.find((entry) => !isLate(entry))),
		lateExport: span(exportParts.find(isLate)),
		rowInDom: marks.rowInDomAt,
		rowPainted: painted,
		lateShown: marks.lateShownAt,
		stallAtFirstRow: marks.stallAtFirstRow,
		storeWindow: { ...marks.storeWindow },
	};
}

export const changesAfter = (began: number) => {
	const asked = (
		performance.getEntriesByType("resource") as PerformanceResourceTiming[]
	).find(
		(entry) =>
			entry.name.includes("/library/changes") && entry.startTime >= began,
	);
	return asked ? { start: asked.startTime, end: asked.responseEnd } : null;
};

export const stateAnswers = () =>
	(globalThis as unknown as Host).__perf.marks.stateAnswers;

export const firstRowAt = () =>
	(globalThis as unknown as Host).__perf.firstRowAt;

export function armKeystroke({
	query,
	countBefore,
}: {
	query: string;
	countBefore: string | null;
}) {
	(globalThis as unknown as Host).__perf.keystroke = new Promise<number>(
		(resolve) => {
			const input = document.querySelector<HTMLInputElement>(
				'input[role="combobox"]',
			);
			let pressedAt = 0;
			input?.addEventListener(
				"keydown",
				() => {
					pressedAt = performance.now();
				},
				{ capture: true, once: true },
			);

			const settled = () => {
				if (pressedAt === 0 || input?.value !== query) return false;
				const count = document.querySelector<HTMLElement>("[data-pending]");
				return (
					count?.dataset.pending === "false" &&
					count.textContent !== countBefore
				);
			};
			const watching = new MutationObserver(() => {
				if (!settled()) return;
				watching.disconnect();
				(globalThis as unknown as Host).__perf.afterPaint(() =>
					resolve(performance.now() - pressedAt),
				);
			});
			watching.observe(document.body, {
				subtree: true,
				childList: true,
				attributes: true,
				characterData: true,
			});
		},
	);
}

export const keystrokeMs = () => {
	const timing = (globalThis as unknown as Host).__perf.keystroke;
	if (timing === null) throw new Error("no keystroke was armed");
	return timing;
};

export const searchCount = () =>
	document.querySelector<HTMLElement>("[data-pending]")?.textContent ?? null;

export function timeOpening({ hash, shown }: { hash: string; shown: string }) {
	return new Promise<number>((resolve) => {
		const began = performance.now();
		const watching = new MutationObserver(() => {
			if (!document.querySelector(shown)) return;
			watching.disconnect();
			(globalThis as unknown as Host).__perf.afterPaint(() =>
				resolve(performance.now() - began),
			);
		});
		watching.observe(document, { subtree: true, childList: true });
		const link = document.createElement("a");
		link.href = hash;
		document.body.append(link);
		link.click();
		link.remove();
	});
}

export function timeRowCount(rows: number) {
	return new Promise<{
		ms: number;
		sinceStateMovedMs: number | null;
		movedAt: number | null;
		began: number;
	}>((resolve) => {
		const { stateAnswers } = (globalThis as unknown as Host).__perf.marks;
		const baseline =
			[...stateAnswers].reverse().find((answer) => answer.structure !== null)
				?.structure ?? null;
		const began = performance.now();
		const reached = () =>
			document.querySelector('[role="grid"]')?.getAttribute("aria-rowcount") ===
			String(rows);
		const done = () =>
			(globalThis as unknown as Host).__perf.afterPaint(() => {
				const painted = performance.now();
				const moved = stateAnswers.find(
					(answer) =>
						answer.at >= began &&
						answer.structure !== null &&
						answer.structure !== baseline,
				);
				resolve({
					ms: painted - began,
					sinceStateMovedMs: moved ? painted - moved.at : null,
					movedAt: moved?.at ?? null,
					began,
				});
			});
		if (reached()) return done();
		const watching = new MutationObserver(() => {
			if (!reached()) return;
			watching.disconnect();
			done();
		});
		watching.observe(document, {
			subtree: true,
			childList: true,
			attributes: true,
			attributeFilter: ["aria-rowcount"],
		});
	});
}

export const describePage = () => {
	const count = document.querySelector<HTMLElement>("[data-pending]");
	const input = document.querySelector<HTMLInputElement>(
		'input[role="combobox"]',
	);
	return [
		`hash ${location.hash}`,
		`search field ${JSON.stringify(input?.value ?? null)}`,
		`match count ${JSON.stringify(count?.textContent ?? null)} pending ${count?.dataset.pending ?? "absent"}`,
		`aria-rowcount ${document.querySelector('[role="grid"]')?.getAttribute("aria-rowcount") ?? "absent"}`,
		`rows in the DOM ${document.querySelectorAll("[data-row]").length}`,
		`longest timer gap ${Math.round((globalThis as unknown as Host).__perf.stallMs())} ms`,
	].join(", ");
};
