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
	audibleMark,
	audiblePosition,
	bufferedStart,
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
// A stream that has not started is not one that has stalled: reconnecting
// restarts the buffering a slow start is waiting on. Applies until the first
// sample; the stopped check still runs at `STALL_MS`.
const START_MS = 25_000;
// How long a seek may stay pending. Reached only when no mark arrives to end it,
// which a component that marks seeks never does -- but a frozen position is not
// a thing to leave without a floor.
const SEEK_WAIT_MS = 20_000;
const WATCHDOG_MS = 1000;
// The marks, not the anchor -- that is fixed for the life of a connection.
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
	// Which track is coming out of the speaker. Published on change only, never
	// per frame. See `audible.ts`.
	audiblePath: string | null;
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
let timelineTimer: ReturnType<typeof setTimeout> | null = null;

let anchor: number | null = null;
// The last `/stream/timeline` answer and when it arrived. Kept rather than
// consumed: the anchor needs it paired with a buffered range, and the two become
// available in either order.
let timelineStreamTime: number | null = null;
let timelineAt = 0;
// When this element was pointed at the stream. The clock runs at 1x, so any
// later answer carries back to here.
let connectAt = 0;
let marks: StreamMark[] = [];
let audiblePath: string | null = null;
// A seek the player has taken and this device has not heard yet, with the
// audible mark current when it was asked for. **The control holds where it was
// put**: snapping back to what is still audible reads as the click having been
// refused, and letting it run on from the target would only have to jump back
// when the audio arrives.
let pendingSeek: number | null = null;
let pendingMarkAt = 0;
let pendingAt = 0;
let lastTime = 0;
let lastAdvance = 0;
// Which of the two waits above applies.
let hasRendered = false;
// Bumps on every connect so a ticket or a timeline that settles after the
// connection it belonged to was torn down is discarded rather than applied.
let generation = 0;

let snapshot: ListenSnapshot = build();

function build(): ListenSnapshot {
	return { phase, format, volumeDb, isMuted, canSetVolume, audiblePath };
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
	audio.addEventListener("timeupdate", onTimeUpdate);
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
	hasRendered = true;
	deriveAnchor();
}

// `timeupdate` fires about four times a second, which is the resolution the
// audible track needs and one timer fewer than polling. Publishes only when the
// answer moves.
function onTimeUpdate() {
	deriveAnchor();

	const mark =
		element && phase.kind === "playing"
			? audibleMark(anchor, marks, element.currentTime)
			: null;

	// The audio has reached the seek when the mark under it is a later one than
	// the mark the seek was asked for from.
	if (
		pendingSeek !== null &&
		((mark !== null && mark.at > pendingMarkAt) ||
			performance.now() - pendingAt > SEEK_WAIT_MS)
	)
		pendingSeek = null;

	const next = mark?.path ?? null;
	if (next === audiblePath) return;
	audiblePath = next;
	publish();
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
	timelineStreamTime = null;
	marks = [];
	audiblePath = null;
	pendingSeek = null;
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
	// Noted before the request goes out: this instant is the only record of what
	// the component sends while the browser is still buffering to start.
	connectAt = performance.now();
	audio.src = streamUrl(target.origin, issued.ticket.ticket, next);
	audio.volume = amplitudeOf(volumeDb);

	startWatchdog();
	// Straight away rather than on the first poll: without it there is no anchor,
	// and so no correction at all.
	void reloadMarks();

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
	hasRendered = false;
	watchdogTimer = setInterval(watch, WATCHDOG_MS);
	timelineTimer = setInterval(() => void refreshTimeline(), TIMELINE_POLL_MS);
}

async function watch() {
	const audio = element;
	if (!audio || !isListening()) return;
	if (phase.kind === "blocked" || phase.kind === "busy") return;

	if (audio.currentTime !== lastTime) {
		lastTime = audio.currentTime;
		lastAdvance = performance.now();
		hasRendered = true;
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

	// Playing at the other end and nothing here yet -- a start, not a stall.
	if (!hasRendered && performance.now() - lastAdvance < START_MS) return;

	scheduleReconnect();
}

// ---- the stream clock --------------------------------------------------------

// Fixed once per connection, and **retried until it takes** -- from `playing`,
// every `timeupdate` and every poll. The two terms arrive in either order, and a
// connection whose first request failed must still end up anchored.
function deriveAnchor() {
	if (anchor !== null || timelineStreamTime === null || !element) return;

	const origin = bufferedStart(element);
	if (origin === null) return;

	const atConnect = timelineStreamTime - (timelineAt - connectAt) / 1000;
	anchor = anchorOf(atConnect, origin);
}

// The marks alone. The anchor is not touched -- see `deriveAnchor`.
async function reloadMarks() {
	if (!target || !element || !isListening()) return;

	const mine = generation;
	const timeline = await fetchStreamTimeline(target.origin, target.token);
	if (!timeline || mine !== generation || !element) return;

	marks = timeline.marks;
	timelineStreamTime = timeline.streamTime;
	timelineAt = performance.now();
	deriveAnchor();
}

// A track change or a seek lays a mark this client does not hold. Called from
// `audible.ts`, which is the one place that already tells those apart.
export const refreshTimeline = () => void reloadMarks();

// Read per animation frame by the seek bar, so it reads `currentTime` at call
// time rather than pushing sixty notifications a second through the store.
export function listeningPosition(
	path: string | null | undefined,
	duration: number,
): number | null {
	if (!element || phase.kind !== "playing") return null;
	// Held, not advanced: the audio it is waiting for has not moved either, so
	// ticking on from the target would put the bar ahead of the sound by the lag
	// and then have to step back.
	if (pendingSeek !== null) return pendingSeek;
	return audiblePosition(anchor, marks, element.currentTime, path, duration);
}

// The player has been asked to seek. Ignored unless this device is listening,
// where it is the difference between a control that answers and one that looks
// broken for as long as the buffer is deep.
export function beginSeek(position: number) {
	if (!isListening() || !element) return;

	pendingSeek = position;
	pendingMarkAt =
		audibleMark(anchor, marks, element.currentTime)?.at ??
		Number.NEGATIVE_INFINITY;
	pendingAt = performance.now();
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

// ---- diagnostics -------------------------------------------------------------

// Dev only. The stream clock cannot be read off the screen -- too early and
// exactly right look identical -- so `__jeanStream()` prints it. `lagSeconds` is
// the figure; a null anchor means no correction is being applied at all.
if (import.meta.env.DEV) {
	(globalThis as unknown as Record<string, unknown>).__jeanStream = () => {
		const audio = element;
		const ranges = audio?.buffered;
		const liveNow =
			timelineStreamTime === null
				? null
				: timelineStreamTime + (performance.now() - timelineAt) / 1000;

		return {
			phase: phase.kind,
			format,
			anchor,
			currentTime: audio?.currentTime ?? null,
			bufferedStart: audio ? bufferedStart(audio) : null,
			bufferedEnd:
				ranges && ranges.length > 0 ? ranges.end(ranges.length - 1) : null,
			// Seconds behind the live edge: what the correction comes to.
			lagSeconds:
				anchor === null || !audio || liveNow === null
					? null
					: liveNow - (anchor + audio.currentTime),
			audiblePath,
			marks,
		};
	};
}

// ---- teardown ----------------------------------------------------------------

function stopStream() {
	generation += 1;
	if (reconnectTimer) clearTimeout(reconnectTimer);
	if (watchdogTimer) clearInterval(watchdogTimer);
	if (timelineTimer) clearTimeout(timelineTimer);
	reconnectTimer = null;
	watchdogTimer = null;
	timelineTimer = null;
	anchor = null;
	timelineStreamTime = null;
	marks = [];
	audiblePath = null;
	pendingSeek = null;

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
