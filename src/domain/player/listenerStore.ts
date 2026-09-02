import { fetchPlayer } from "@/shared/api/beefweb";
import {
	fetchStreamTimeline,
	issueStreamTicket,
	type StreamMark,
	streamUrl,
} from "@/shared/api/fooJean";
import { subscribers } from "@/shared/lib/store";
import {
	amplitudeOf,
	anchorOf,
	audiblePosition,
	DEVICE_VOLUME_FLOOR_DB,
	decibelsOf,
	type ListenTarget,
} from "./listener";

// The live connection: one `<audio>` element, the reconnect loop, the codec
// fall-through and the stream clock. A store rather than a hook, because the
// element has to outlive every component that draws a control over it -- and
// named for the store rather than for the control beside it, which a
// case-insensitive filesystem could not tell apart. See the root CLAUDE.md.

// Per device, never synced. Two devices decide for themselves, and one device's
// fader must never move another's.
const VOLUME_KEY = "jean.listenVolume";

const RECONNECT_MS = [500, 1000, 2000, 4000, 8000];
const BUSY_RETRY_MS = 5000;
// How long `currentTime` may stand still while the element believes it is
// playing. A live stream that dies fires `stalled` and `waiting`, never `error`,
// so nothing else notices.
const STALL_MS = 6000;
const WATCHDOG_MS = 1000;
const TIMELINE_POLL_MS = 10_000;

// **A stopped player and a broken stream are identical from the stream**: the
// container headers arrive and then nothing, with no error and no timeout. Only
// beefweb can say which, and "foobar2000 is stopped" and "could not reach the
// stream" are different sentences with different remedies.
export type ListenPhase =
	| { kind: "off" }
	| { kind: "connecting" }
	| { kind: "playing" }
	| { kind: "reconnecting"; attempt: number }
	// The browser refused an autoplay that had lost its user gesture across an
	// await. One more tap fixes it; see `resume`.
	| { kind: "blocked" }
	// The component is serving as many listeners as it will. Retryable, and it
	// must not read as "not supported".
	| { kind: "busy"; message: string }
	// Playing, connected, and there is nothing coming because the player is not
	// playing anything.
	| { kind: "silent" }
	| { kind: "failed"; message: string };

export interface ListenSnapshot {
	phase: ListenPhase;
	format: string | null;
	// Decibels on the player's own scale, so one fader law serves both targets.
	volumeDb: number;
	isMuted: boolean;
	// False on iOS, where `audio.volume` is a documented no-op and the hardware
	// keys are the only volume there is. Probed, never sniffed.
	canSetVolume: boolean;
}

const listeners = subscribers();

let element: HTMLAudioElement | null = null;
let target: ListenTarget | null = null;
let format: string | null = null;
let phase: ListenPhase = { kind: "off" };
let volumeDb = readStoredVolume();
let isMuted = false;
let canSetVolume = true;

// Formats this browser has already failed to decode. Remembered for the session
// so a reconnect does not try them again on every attempt.
const dead = new Set<string>();

let attempt = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let watchdogTimer: ReturnType<typeof setInterval> | null = null;
let timelineTimer: ReturnType<typeof setInterval> | null = null;

let anchor: number | null = null;
let marks: StreamMark[] = [];
let lastTime = 0;
let lastAdvance = 0;
// Bumps on every connect so a ticket or a timeline that settles after the
// connection it belonged to was torn down is discarded rather than applied.
let generation = 0;

let snapshot: ListenSnapshot = build();

function build(): ListenSnapshot {
	return { phase, format, volumeDb, isMuted, canSetVolume };
}

function publish() {
	snapshot = build();
	listeners.notify();
}

function readStoredVolume() {
	try {
		const stored = localStorage.getItem(VOLUME_KEY);
		return stored === null ? 0 : (JSON.parse(stored) as number);
	} catch {
		return 0;
	}
}

export const subscribeListening = listeners.subscribe;
export const listeningSnapshot = () => snapshot;
// `useSyncExternalStore` calls this before hydration and it must not touch the
// DOM; the element is created on the first connect and never at import.
export const listeningServerSnapshot = () => snapshot;

export const isListening = () =>
	phase.kind !== "off" && phase.kind !== "failed";

// ---- the element -------------------------------------------------------------

function ensureElement() {
	if (element) return element;

	const audio = new Audio();
	// **No `crossorigin`.** It makes the media request CORS-checked for no
	// benefit; it is only needed for Web Audio, which this must not use.
	audio.preload = "none";
	audio.autoplay = false;

	// Probe rather than sniff: iOS reports the assignment and keeps 1.
	audio.volume = 0.5;
	canSetVolume = Math.abs(audio.volume - 0.5) < 0.01;
	audio.volume = amplitudeOf(volumeDb);
	audio.muted = isMuted;

	audio.addEventListener("playing", onPlaying);
	audio.addEventListener("error", onError);
	audio.addEventListener("ended", onEnded);

	// Attached rather than left detached. It draws nothing -- `controls` is off
	// and it is `hidden` -- but an element in the document is the one browsers
	// treat as the page's media for the OS-level controls, and it is the only
	// thing a test can find without the app growing a hook for the suite.
	audio.hidden = true;
	document.body.appendChild(audio);

	element = audio;
	return audio;
}

function onPlaying() {
	if (!isListening()) return;
	attempt = 0;
	setPhase({ kind: "playing" });
	lastTime = element?.currentTime ?? 0;
	lastAdvance = performance.now();
	void reanchor();
}

// **`error.code` is the only thing separating "cannot play this" from "the Wi-Fi
// dropped"**, and the two want opposite responses.
function onError() {
	if (!isListening()) return;
	const code = element?.error?.code;

	if (
		code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED ||
		code === MediaError.MEDIA_ERR_DECODE
	) {
		if (format) dead.add(format);
		nextFormat();
		return;
	}

	scheduleReconnect();
}

// An endless response ends on every network blip, and an `<audio>` element will
// not retry by itself.
function onEnded() {
	if (isListening()) scheduleReconnect();
}

// ---- connecting --------------------------------------------------------------

function setPhase(next: ListenPhase) {
	phase = next;
	publish();
}

function liveFormats() {
	return (target?.formats ?? []).filter((name) => !dead.has(name));
}

function nextFormat() {
	const remaining = liveFormats();
	if (remaining.length === 0) {
		stopStream();
		// **Deliberately not "this browser cannot decode it".** A refused ticket
		// and an undecodable codec reach the element as the same `MEDIA_ERR`, and
		// the component answers 401 identically for a missing, unknown and expired
		// ticket on purpose -- so naming a cause here would be a guess. `retry`
		// is what makes the vaguer sentence actionable.
		setPhase({
			kind: "failed",
			message: "Could not play the stream on this device.",
		});
		return;
	}
	void open(remaining[0]);
}

export function connect() {
	if (!target) return;
	teardown();
	attempt = 0;
	nextFormat();
}

// Clears what the session had written off. A codec ruled out by one failure is
// ruled out for good *within* an attempt; asking again is the user saying the
// failure may not have been about the codec at all.
export function retry() {
	dead.clear();
	connect();
}

async function open(next: string) {
	if (!target) return;

	const mine = ++generation;
	format = next;
	anchor = null;
	marks = [];
	setPhase(
		attempt > 0 ? { kind: "reconnecting", attempt } : { kind: "connecting" },
	);

	// Asked for immediately before connecting, never held and never stored.
	const issued = await issueStreamTicket(target.origin, target.token);
	if (mine !== generation) return;

	if (!issued.ok) {
		if (issued.reason === "busy") {
			setPhase({ kind: "busy", message: issued.message });
			reconnectTimer = setTimeout(() => {
				if (mine === generation) void open(next);
			}, BUSY_RETRY_MS);
			return;
		}
		if (issued.reason === "unreachable") {
			scheduleReconnect();
			return;
		}
		setPhase({ kind: "failed", message: issued.message });
		return;
	}

	const audio = ensureElement();
	audio.src = streamUrl(target.origin, issued.ticket.ticket, next);
	audio.volume = amplitudeOf(volumeDb);
	startWatchdog();

	try {
		await audio.play();
	} catch (error) {
		if (mine !== generation) return;
		// **`play()` after an await has lost its user gesture.** Degrade to a
		// control the user presses synchronously rather than reaching for
		// cleverness -- one extra tap, and it is the only thing that works.
		if ((error as DOMException)?.name === "NotAllowedError") {
			setPhase({ kind: "blocked" });
			return;
		}
		scheduleReconnect();
	}
}

// Called straight out of a click handler, with no await in front of it.
export function resume() {
	const audio = element;
	if (!audio || phase.kind !== "blocked") return;
	setPhase({ kind: "connecting" });
	audio.play().catch(() => scheduleReconnect());
}

function scheduleReconnect() {
	if (!target) return;
	if (reconnectTimer) clearTimeout(reconnectTimer);

	if (attempt >= RECONNECT_MS.length) {
		// **Give up visibly rather than silently**, and offer the way back.
		stopStream();
		setPhase({
			kind: "failed",
			message: "The stream keeps dropping. Check that foobar2000 is running.",
		});
		return;
	}

	const wait = RECONNECT_MS[attempt];
	attempt += 1;
	setPhase({ kind: "reconnecting", attempt });
	// A fresh ticket every attempt, which is what `open` does. **Never a second
	// element to probe with**: Safari already holds two connections per listener,
	// and `maxConcurrentStreams` counts connections rather than people.
	reconnectTimer = setTimeout(() => {
		const remaining = liveFormats();
		if (remaining.length > 0) void open(format ?? remaining[0]);
	}, wait);
}

// ---- the stall watchdog ------------------------------------------------------

function startWatchdog() {
	if (watchdogTimer) return;
	lastTime = 0;
	lastAdvance = performance.now();
	watchdogTimer = setInterval(watch, WATCHDOG_MS);
	timelineTimer = setInterval(() => void reanchor(), TIMELINE_POLL_MS);
}

async function watch() {
	const audio = element;
	if (!audio || !isListening()) return;
	if (phase.kind === "blocked" || phase.kind === "busy") return;

	if (audio.currentTime !== lastTime) {
		lastTime = audio.currentTime;
		lastAdvance = performance.now();
		if (phase.kind === "silent") setPhase({ kind: "playing" });
		return;
	}

	if (audio.paused) return;
	if (performance.now() - lastAdvance < STALL_MS) return;

	// The whole reason this asks beefweb: from the stream alone these two are
	// the same event, and only one of them is Jean's fault.
	const stopped = await fetchPlayer()
		.then((player) => player.playbackState !== "playing")
		.catch(() => false);

	if (!isListening()) return;
	if (stopped) {
		setPhase({ kind: "silent" });
		lastAdvance = performance.now();
		return;
	}

	scheduleReconnect();
}

// ---- the stream clock --------------------------------------------------------

// Re-anchored on every reconnect, because `currentTime` restarts, and re-polled
// while playing to shed drift. Over minutes the difference is milliseconds; over
// an evening it is not.
async function reanchor() {
	if (!target || !element || !isListening()) return;

	const mine = generation;
	const at = performance.now();
	const timeline = await fetchStreamTimeline(target.origin, target.token);
	if (!timeline || mine !== generation || !element) return;

	anchor = anchorOf(
		timeline.streamTime,
		performance.now() - at,
		element.currentTime,
	);
	marks = timeline.marks;
}

// Read per animation frame by the seek bar, so it reads `currentTime` at call
// time rather than pushing sixty notifications a second through the store.
export function listeningPosition(
	path: string | null | undefined,
	duration: number,
): number | null {
	if (!element || phase.kind !== "playing") return null;
	return audiblePosition(anchor, marks, element.currentTime, path, duration);
}

// ---- volume ------------------------------------------------------------------

export function setListeningVolume(db: number) {
	volumeDb = Math.max(DEVICE_VOLUME_FLOOR_DB, Math.min(0, db));
	// Moving the fader unmutes, as it does on the player's: a slider that can be
	// dragged to no effect is the control lying about what it does.
	isMuted = false;
	if (element) {
		element.volume = amplitudeOf(volumeDb);
		element.muted = false;
	}
	try {
		localStorage.setItem(VOLUME_KEY, JSON.stringify(volumeDb));
	} catch {
		// Private mode, quota -- the level just does not survive a reload.
	}
	publish();
}

// `muted` rather than a level of zero, so unmuting returns the level that was
// set rather than a remembered one this would have to hold.
export function toggleListeningMute() {
	isMuted = !isMuted;
	if (element) element.muted = isMuted;
	publish();
}

export const listeningVolumeFloor = DEVICE_VOLUME_FLOOR_DB;
export { decibelsOf };

// ---- teardown ----------------------------------------------------------------

function stopStream() {
	generation += 1;
	if (reconnectTimer) clearTimeout(reconnectTimer);
	if (watchdogTimer) clearInterval(watchdogTimer);
	if (timelineTimer) clearInterval(timelineTimer);
	reconnectTimer = null;
	watchdogTimer = null;
	timelineTimer = null;
	anchor = null;
	marks = [];

	const audio = element;
	if (audio) {
		audio.pause();
		// Both, and in this order: clearing `src` alone leaves the connection open
		// in some browsers, and `load()` is what actually abandons it.
		audio.removeAttribute("src");
		audio.load();
	}
}

function teardown() {
	stopStream();
	format = null;
}

export function disconnect() {
	teardown();
	setPhase({ kind: "off" });
}

// Idempotent, so every caller of the hook may state the target without the
// second one tearing down the first one's connection.
export function configureListening(next: ListenTarget | null) {
	const same =
		target?.origin === next?.origin &&
		target?.token === next?.token &&
		target?.formats.join() === next?.formats.join();
	if (same) return;

	if (isListening()) disconnect();
	target = next;
	dead.clear();
}
