import { LET_GO, NARROW, TAKE, WIDE } from "./labels.ts";

// A service worker persists at its scope until unregistered, whatever page loaded it last, so any
// worker still registered at this page's own address would keep intercepting its requests
// indefinitely if nothing here cleared it. The demo's own worker is a scope down and is left alone.
void navigator.serviceWorker?.getRegistrations().then((registrations) => {
	const here = new URL("./", location.href).href;
	for (const registration of registrations)
		if (registration.scope === here) void registration.unregister();
});

const AHEAD = "400px";

interface Pane {
	figure: HTMLElement;
	frame: HTMLElement;
	pill: HTMLButtonElement;
}

let live: Pane | null = null;

const iframeOf = (frame: HTMLElement) =>
	frame.querySelector<HTMLIFrameElement>("iframe");

function release() {
	const pane = live;
	if (!pane) return;
	live = null;

	delete pane.frame.dataset.live;
	const iframe = iframeOf(pane.frame);
	if (iframe) iframe.inert = true;
	pane.pill.textContent = TAKE;
	pane.pill.setAttribute("aria-pressed", "false");
}

function mount(frame: HTMLElement) {
	if (iframeOf(frame)) return;

	const iframe = document.createElement("iframe");
	// A screen reader reaches each iframe as a document of its own, named by its `title`.
	iframe.title = frame.dataset.frameTitle ?? "";
	iframe.inert = true;
	iframe.addEventListener(
		"load",
		() => {
			frame.dataset.ready = "true";
			// `contentDocument` is null for a cross-origin frame.
			iframe.contentDocument?.addEventListener("keydown", (event) => {
				if (event.key === "Escape" && live?.frame === frame) release();
			});
		},
		{ once: true },
	);
	iframe.src = frame.dataset.src ?? "";
	frame.prepend(iframe);
}

function take(pane: Pane) {
	if (live?.frame === pane.frame) return release();
	release();
	mount(pane.frame);
	live = pane;
	pane.frame.dataset.live = "true";

	const iframe = iframeOf(pane.frame);
	if (iframe) {
		iframe.inert = false;
		iframe.focus();
	}

	pane.pill.textContent = LET_GO;
	pane.pill.setAttribute("aria-pressed", "true");
}

const watcher = new IntersectionObserver(
	(entries) => {
		for (const entry of entries) {
			if (!entry.isIntersecting) continue;
			mount(entry.target as HTMLElement);
			watcher.unobserve(entry.target);
		}
	},
	{ rootMargin: AHEAD },
);

for (const frame of document.querySelectorAll<HTMLElement>(".frame")) {
	if (frame.dataset.eager === undefined) watcher.observe(frame);
	else mount(frame);
}

for (const figure of document.querySelectorAll<HTMLElement>(".embed")) {
	const frame = figure.querySelector<HTMLElement>(".frame");
	const pill = figure.querySelector<HTMLButtonElement>(".frame-pill");
	if (!frame || !pill) continue;

	const pane: Pane = { figure, frame, pill };
	frame
		.querySelector(".frame-catch")
		?.addEventListener("click", () => take(pane));
	pill.addEventListener("click", () => take(pane));
}

// A click inside a live frame never reaches this listener: it belongs to the iframe's own
// document, not this one.
document.addEventListener("click", (event) => {
	if (live && !live.figure.contains(event.target as Node)) release();
});

for (const compare of document.querySelectorAll<HTMLElement>(".compare")) {
	const range = compare.querySelector<HTMLInputElement>(".compare-range");
	range?.addEventListener("input", () =>
		compare.style.setProperty("--split", `${range.value}%`),
	);

	const narrow = compare
		.closest(".embed")
		?.querySelector<HTMLButtonElement>(".frame-narrow");
	narrow?.addEventListener("click", () => {
		const isWide = compare.toggleAttribute("data-wide");
		narrow.textContent = isWide ? NARROW : WIDE;
		narrow.setAttribute("aria-pressed", String(isWide));
	});
}
