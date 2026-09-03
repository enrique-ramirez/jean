import { TOKEN_KEY } from "../src/shared/api/fooJean";
import "./badge.css";

// The only file that knows the app is a demo. It installs the player (a service
// worker, see `sw.ts`), waits until that worker is the one answering, and only
// then mounts the app's own `main.tsx`, imported unchanged.

const DISMISSED = "jean.demoChipDismissed";

// The token the component would have handed over at pairing, seeded so a visitor
// arrives at a paired install. Pairing itself is a screen in Settings.
const DEMO_TOKEN = "0123456789abcdef0123456789abcdef";

// The play-count shading introduces itself on first sight, and a popover over
// the toolbar is not what a demo should open on.
const SEED: Record<string, unknown> = {
	"jean.heatIntroSeen": true,
	"jean.settingsSeen": true,
};

// Everything the demo remembers: the player's state in the worker's journal, and
// the settings under the app's own keys.
async function reset() {
	await fetch("/__demo/reset", { method: "POST" }).catch(() => {});
	for (const key of Object.keys(localStorage))
		if (key.startsWith("jean.")) localStorage.removeItem(key);
	location.reload();
}

const chip = () => {
	if (localStorage.getItem(DISMISSED)) return;

	const element = document.createElement("div");
	element.className = "demo-chip";
	element.innerHTML =
		'<span><b>Demo</b> <span class="demo-chip-note">&mdash; a real library, no audio</span></span>' +
		'<button type="button" class="demo-chip-reset">Reset</button>' +
		'<button type="button" class="demo-chip-close" aria-label="Dismiss">&times;</button>';

	element
		.querySelector(".demo-chip-reset")
		?.addEventListener("click", () => void reset());
	element.querySelector(".demo-chip-close")?.addEventListener("click", () => {
		localStorage.setItem(DISMISSED, "true");
		element.remove();
	});

	// Out of the way on the now-playing screen, which on a phone is the whole
	// window and puts its seek bar exactly where the chip sits.
	const follow = () =>
		element.toggleAttribute(
			"data-hidden",
			location.hash.startsWith("#/playing"),
		);
	window.addEventListener("hashchange", follow);
	follow();

	document.body.append(element);
};

const unsupported = () => {
	document.body.innerHTML =
		'<p style="font:14px/1.6 system-ui;max-width:36rem;margin:20vh auto;padding:0 1.5rem">' +
		"This demo runs the whole player inside a service worker, and this browser " +
		"has them switched off or unavailable. Jean itself needs nothing of the " +
		"sort &mdash; it is served by beefweb, on the machine playing the music." +
		"</p>";
};

async function start() {
	if (!("serviceWorker" in navigator)) return unsupported();

	// The other way back to a clean demo, once the chip has been dismissed.
	if (location.search.includes("reset")) {
		await reset();
		return;
	}

	// `updateViaCache: 'none'` so a visitor gets today's demo rather than a cached
	// one; `skipWaiting` and `clients.claim` in the worker are the other half.
	//
	// The URL resolves against the page rather than this module: the module is
	// hashed into `assets/`, and a worker registered from there would take
	// `assets/` as its scope and control nothing.
	await navigator.serviceWorker.register(new URL("sw.js", document.baseURI), {
		scope: "./",
		updateViaCache: "none",
	});
	await navigator.serviceWorker.ready;

	// Registered is not the same as answering. The first visit installs a worker
	// that has not claimed this page yet, and mounting into that gap sends the
	// app's first requests to the network, where they 404.
	if (!navigator.serviceWorker.controller)
		await new Promise<void>((resolve) => {
			// A worker that never claims is a broken deploy, and a reload fixes it.
			// Cleared on the way out, or it reloads a demo that was already working.
			const giveUp = setTimeout(() => location.reload(), 4000);
			navigator.serviceWorker.addEventListener("controllerchange", () => {
				clearTimeout(giveUp);
				resolve();
			});
		});

	// JSON, because that is how `useStoredState` reads: a bare string parses as
	// nothing and the app reports a component it has no token for.
	localStorage.setItem(TOKEN_KEY, JSON.stringify(DEMO_TOKEN));
	for (const [key, value] of Object.entries(SEED))
		if (localStorage.getItem(key) === null)
			localStorage.setItem(key, JSON.stringify(value));

	await import("../src/main");
	chip();
}

void start();
