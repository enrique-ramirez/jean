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
	viewportPainted: (scroller: HTMLElement) => Promise<void>;
	keystroke: Promise<number> | null;
	marks: Marks;
}

interface Marks {
	lateShownAt: number | null;
	stateAnswers: { at: number; structure: string | null }[];
}

export type Host = { __perf: PagePerf };

export function installProbes() {
	const BUSY_ROW = '[data-row][aria-busy="true"]';
	// The default buffer holds 250 entries, which a screenful of covers fills before the page is read.
	performance.setResourceTimingBufferSize(10_000);
	let stall = 0;
	let longTask = 0;
	let last = performance.now();
	const tick = () => {
		const now = performance.now();
		if (now - last > stall) stall = now - last;
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
		lateShownAt: null,
		stateAnswers: [],
	};

	const pageFetch = globalThis.fetch;
	globalThis.fetch = async (input, init) => {
		const answer = await pageFetch.call(globalThis, input, init);
		const url =
			typeof input === "string"
				? input
				: input instanceof URL
					? input.href
					: input.url;
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
		viewportPainted: async (scroller) => {
			const GIVE_UP_MS = 30_000;
			const inViewport = () => {
				const view = scroller.getBoundingClientRect();
				return [...document.querySelectorAll<HTMLElement>("[data-row]")]
					.map((row) => ({ row, box: row.getBoundingClientRect() }))
					.filter(({ box }) => box.bottom > view.top && box.top < view.bottom);
			};
			const isPainted = () => {
				const rows = inViewport();
				if (rows.length === 0) return false;
				if (rows.some(({ row }) => row.matches(BUSY_ROW))) return false;
				const atEnd =
					scroller.scrollTop >=
					scroller.scrollHeight - scroller.clientHeight - 1;
				const bottom = Math.max(...rows.map(({ box }) => box.bottom));
				return atEnd || bottom >= scroller.getBoundingClientRect().bottom - 1;
			};
			const began = performance.now();
			while (!isPainted()) {
				if (performance.now() - began > GIVE_UP_MS)
					throw new Error("the viewport was not painted");
				await new Promise<void>((resolve) =>
					requestAnimationFrame(() => resolve()),
				);
			}
			await new Promise<void>((resolve) => perf.afterPaint(resolve));
		},
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
		perf.afterPaint(() => {
			perf.firstRowAt = performance.now();
			const isBusy = () => document.querySelector(BUSY_ROW);
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
