// Everything here is serialised into the page by Playwright, so each function carries no reference
// to anything outside its own body.

export interface PagePerf {
	// The longest gap between two turns of a zero-delay timer since `reset`: the main thread was busy
	// for that long. Every engine has it; it includes the timer's own few milliseconds of clamping.
	stallMs: () => number;
	// The longest `longtask` entry since `reset`, or null where the engine has no such observer.
	longTaskMs: () => number | null;
	reset: () => void;
	// `performance.now()` once the frame after the first row of a track list reached the DOM has been
	// painted.
	firstRowAt: number | null;
	// Runs `callback` after the next frame has painted: a message queued from a frame callback is
	// delivered once that frame is on screen.
	afterPaint: (callback: () => void) => void;
	// The measurement `armKeystroke` started, which `keystrokeMs` waits on.
	keystroke: Promise<number> | null;
}

type Host = { __perf: PagePerf };

export function installProbes() {
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

	const perf: PagePerf = {
		firstRowAt: null,
		keystroke: null,
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
		perf.afterPaint(() => {
			perf.firstRowAt = performance.now();
		});
	});
	watching.observe(document, { subtree: true, childList: true });
}

export const resetProbes = () => (globalThis as unknown as Host).__perf.reset();

export const readProbes = () => {
	const perf = (globalThis as unknown as Host).__perf;
	return { stallMs: perf.stallMs(), longTaskMs: perf.longTaskMs() };
};

export const firstRowAt = () =>
	(globalThis as unknown as Host).__perf.firstRowAt;

// Starts timing the next keydown to the paint of the frame after the match count settled on
// `query`, and returns once the listener is installed. Pressing a key before this call has returned
// is a key the page never timed; `keystrokeMs` resolves with the milliseconds. The count is the one
// the search field draws beside the draft; `data-pending` is false once the deferred draft has caught up.
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

// Clicks a link to `hash` from a page that draws none of `shown`, and resolves with the milliseconds
// until the frame after the first match for it has painted.
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

// Resolves with the milliseconds until the frame after the list's `aria-rowcount` read `rows` has
// painted.
export function timeRowCount(rows: number) {
	return new Promise<number>((resolve) => {
		const began = performance.now();
		const reached = () =>
			document.querySelector('[role="grid"]')?.getAttribute("aria-rowcount") ===
			String(rows);
		const done = () =>
			(globalThis as unknown as Host).__perf.afterPaint(() =>
				resolve(performance.now() - began),
			);
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

// What the page shows when a cell gave up, for the reason recorded beside it.
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
