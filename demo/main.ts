import { TOKEN_KEY } from "../src/shared/api/fooJean";
import "./badge.css";

// The demo's entry point, and the only file that knows the app is a demo. It
// installs the player (a service worker, see `sw.ts`), waits until that worker
// is the one answering, and only then mounts Jean -- which is the app's own
// `main.tsx`, imported unchanged. If the app ever had to be told it was in a
// demo, this would have been the wrong design.

const DISMISSED = "jean.demoChipDismissed";

// The token the component would have handed over at pairing. Seeded so a
// visitor arrives at a paired install and can write a rating in one click;
// pairing itself is a screen in Settings, reachable from there by whoever wants
// to see it.
const DEMO_TOKEN = "0123456789abcdef0123456789abcdef";

// Settings the app writes for itself once somebody has met it. Seeded for the
// same reason the suite seeds them: the play-count shading introduces itself on
// first sight, and a popover over the toolbar is not what a demo should open on.
const SEED: Record<string, unknown> = {
	"jean.heatIntroSeen": true,
	"jean.settingsSeen": true,
};

// Everything the demo remembers, which is what a reset is a reset *of*: the
// player's own state lives in the worker's journal, and the settings somebody
// changed live here under the app's own keys.
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
	// window and puts its seek bar exactly where the chip sits. There is nothing
	// for a label to sit beside there anyway.
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

	// The other way back to a clean demo, for somebody who dismissed the chip and
	// then wanted the button that was on it.
	if (location.search.includes("reset")) {
		await reset();
		return;
	}

	// `updateViaCache: 'none'` so a visitor gets today's demo rather than the one
	// their browser cached in March; `skipWaiting` and `clients.claim` in the
	// worker are the other half of it.
	// Resolved against the page rather than against this module: the module is
	// hashed into `assets/`, and a worker registered from there would take
	// `assets/` as its scope and control nothing.
	await navigator.serviceWorker.register(new URL("sw.js", document.baseURI), {
		scope: "./",
		updateViaCache: "none",
	});
	await navigator.serviceWorker.ready;

	// Registered is not the same as answering. The first visit installs a worker
	// that has not claimed this page yet, and mounting into that gap means the
	// app's first requests go to the network and 404 -- which looks exactly like
	// a player that is not running.
	if (!navigator.serviceWorker.controller)
		await new Promise<void>((resolve) => {
			// A worker that never claims is a broken deploy rather than a slow one,
			// and a reload is the one thing that reliably fixes it. Cleared on the
			// way out: left armed, it reloads the page four seconds into a demo
			// that was already working.
			const giveUp = setTimeout(() => location.reload(), 4000);
			navigator.serviceWorker.addEventListener("controllerchange", () => {
				clearTimeout(giveUp);
				resolve();
			});
		});

	// JSON, because that is how `useStoredState` reads: a bare string here parses
	// as nothing and the app reports a component it has no token for.
	localStorage.setItem(TOKEN_KEY, JSON.stringify(DEMO_TOKEN));
	for (const [key, value] of Object.entries(SEED))
		if (localStorage.getItem(key) === null)
			localStorage.setItem(key, JSON.stringify(value));

	await import("../src/main");
	chip();
}

void start();
