import { fetchPlayer } from "@/shared/api/beefweb";
import {
	fetchStreamTimeline,
	issueStreamTicket,
	leaveStream,
	type StreamMark,
	streamUrl,
} from "@/shared/api/fooJean";
import { subscribers } from "@/shared/lib/store";
import { deviceId, deviceIdentity } from "./device";
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

// The live connection: one `<audio>` element, the reconnect loop, the codec fall-through and the stream clock.

// Per device, never synced: one device's fader must not move another's.
const VOLUME_KEY = "jean.listenVolume";

const RECONNECT_MS = [500, 1000, 2000, 4000, 8000];
const BUSY_RETRY_MS = 5000;
// How long `currentTime` may stand still while the element believes it is playing.
// A dead live stream fires `stalled` and `waiting`, never `error`, so nothing else notices.
const STALL_MS = 6000;
// Grace for a slow start, until the first sample. The stopped check still runs at `STALL_MS`.
const START_MS = 25_000;
// Floor for a pending seek, reached only when no mark ever arrives to end it.
const SEEK_WAIT_MS = 20_000;
const WATCHDOG_MS = 1000;
const TIMELINE_POLL_MS = 10_000;

// A stopped player and a broken stream look identical from the stream: headers arrive and then nothing.
// Only beefweb can say which, and the two need different sentences.
export type ListenPhase =
	| { kind: "off" }
	| { kind: "connecting" }
	| { kind: "playing" }
	| { kind: "reconnecting"; attempt: number }
	// The browser refused an autoplay whose user gesture was lost across an await; see `resume`.
	| { kind: "blocked" }
	// The component is serving as many listeners as it will. Retryable.
	| { kind: "busy"; message: string }
	// Connected, with nothing coming because the player is not playing.
	| { kind: "silent" }
	| { kind: "failed"; message: string };

export interface ListenSnapshot {
	phase: ListenPhase;
	format: string | null;
	volumeDb: number;
	isMuted: boolean;
	// False on iOS, where `audio.volume` is a documented no-op.
	canSetVolume: boolean;
	// Which track is coming out of the speaker. Published on change only, never per frame.
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

// Formats this browser has failed to decode, so reconnects do not retry them.
const dead = new Set<string>();

let attempt = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let watchdogTimer: ReturnType<typeof setInterval> | null = null;
let timelineTimer: ReturnType<typeof setTimeout> | null = null;

let anchor: number | null = null;
// The last `/stream/timeline` answer and when it arrived. The anchor needs it paired with a buffered range, and the two arrive in either order.
let timelineStreamTime: number | null = null;
let timelineAt = 0;
// When this element was pointed at the stream. The clock runs at 1x, so a later answer carries back to here.
let connectAt = 0;
let marks: StreamMark[] = [];
let audiblePath: string | null = null;
// A seek the player has taken and this device has not heard yet, with the audible mark current when it was asked for.
// The control holds where it was put rather than snapping back to what is still audible.
let pendingSeek: number | null = null;
let pendingMarkAt = 0;
let pendingAt = 0;
let lastTime = 0;
let lastAdvance = 0;
// False until the first sample, which is what chooses between `START_MS` and `STALL_MS`.
let hasRendered = false;
// Bumps on every connect, so a ticket or timeline settling after its connection was torn down is discarded.
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
// `useSyncExternalStore` calls this before hydration, so it must not touch the DOM.
export const listeningServerSnapshot = () => snapshot;

export const isListening = () =>
	phase.kind !== "off" && phase.kind !== "failed";

// ---- the element -------------------------------------------------------------

function ensureElement() {
	if (element) return element;

	const audio = new Audio();
	// No `crossorigin`: it makes the media request CORS-checked, and is only needed for Web Audio.
	audio.preload = "none";
	audio.autoplay = false;

	audio.volume = 0.5;
	canSetVolume = Math.abs(audio.volume - 0.5) < 0.01;
	audio.volume = amplitudeOf(volumeDb);
	audio.muted = isMuted;

	audio.addEventListener("playing", onPlaying);
	audio.addEventListener("timeupdate", onTimeUpdate);
	audio.addEventListener("error", onError);
	audio.addEventListener("ended", onEnded);

	// In the document, though it draws nothing: browsers only treat an attached element as the page's media for the OS controls.
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

// The audio has reached the seek once the mark under it is later than the one the seek was asked for from.
function hasReachedSeek(mark: StreamMark | null) {
	return (
		(mark !== null && mark.at > pendingMarkAt) ||
		performance.now() - pendingAt > SEEK_WAIT_MS
	);
}

// `timeupdate` fires about four times a second, which is one timer fewer than polling.
function onTimeUpdate() {
	deriveAnchor();

	const mark =
		element && phase.kind === "playing"
			? audibleMark(anchor, marks, element.currentTime)
			: null;

	if (pendingSeek !== null && hasReachedSeek(mark)) pendingSeek = null;

	const next = mark?.path ?? null;
	if (next === audiblePath) return;
	audiblePath = next;
	publish();
}

// `error.code` is the only thing separating "cannot play this" from "the Wi-Fi dropped", and the two want opposite responses.
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

// An endless response ends on every network blip, and an `<audio>` element will not retry by itself.
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
		// Deliberately vague: a refused ticket and an undecodable codec reach the element as the same `MEDIA_ERR`.
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

	const issued = await issueStreamTicket(
		target.origin,
		target.token,
		deviceIdentity(),
	);
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
	connectAt = performance.now();
	audio.src = streamUrl(target.origin, issued.ticket.ticket, next);
	audio.volume = amplitudeOf(volumeDb);

	startWatchdog();
	// Straight away rather than on the first poll: without it there is no anchor, and so no correction.
	void reloadMarks();

	try {
		await audio.play();
	} catch (error) {
		if (mine !== generation) return;
		// `play()` after an await has lost its user gesture. The only fix is a control the user presses synchronously.
		if ((error as DOMException)?.name === "NotAllowedError") {
			setPhase({ kind: "blocked" });
			return;
		}
		scheduleReconnect();
	}
}

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
	// Never open a second element to probe with: Safari holds two connections per listener, and `maxConcurrentStreams` counts connections.
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

	// From the stream alone a stopped player and a dead connection are the same event.
	const stopped = await fetchPlayer()
		.then((player) => player.playbackState !== "playing")
		.catch(() => false);

	if (!isListening()) return;
	if (stopped) {
		setPhase({ kind: "silent" });
		lastAdvance = performance.now();
		return;
	}

	if (!hasRendered && performance.now() - lastAdvance < START_MS) return;

	scheduleReconnect();
}

// ---- the stream clock --------------------------------------------------------

// Fixed once per connection, and retried from `playing`, every `timeupdate` and every poll: the two terms arrive in either order.
function deriveAnchor() {
	if (anchor !== null || timelineStreamTime === null || !element) return;

	const origin = bufferedStart(element);
	if (origin === null) return;

	const atConnect = timelineStreamTime - (timelineAt - connectAt) / 1000;
	anchor = anchorOf(atConnect, origin);
}

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

// A track change or a seek lays a mark this client does not hold.
export const refreshTimeline = () => void reloadMarks();

// Read per animation frame by the seek bar, so it reads `currentTime` at call time rather than notifying the store.
export function listeningPosition(
	path: string | null | undefined,
	duration: number,
): number | null {
	if (!element || phase.kind !== "playing") return null;
	// Held rather than advanced: the audio it is waiting for has not moved either.
	if (pendingSeek !== null) return pendingSeek;
	return audiblePosition(anchor, marks, element.currentTime, path, duration);
}

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
	isMuted = false;
	if (element) {
		element.volume = amplitudeOf(volumeDb);
		element.muted = false;
	}
	try {
		localStorage.setItem(VOLUME_KEY, JSON.stringify(volumeDb));
	} catch {
		// Private mode or quota; the level does not survive a reload.
	}
	publish();
}

// `muted` rather than a level of zero, so unmuting returns the level that was set.
export function toggleListeningMute() {
	isMuted = !isMuted;
	if (element) element.muted = isMuted;
	publish();
}

export const listeningVolumeFloor = DEVICE_VOLUME_FLOOR_DB;
export { decibelsOf };

// ---- what the audience store reads -------------------------------------------

// The roster comes from the same component this device streams from, so it reads the target here rather than resolving a second one out of discovery.
export const listenTarget = () => target;

// How far behind the player this device is, or null while nothing is listening or the clock has not settled.
// Sampled by a caller rather than published: it moves continuously, and a store notifying on it would repaint the app sixty times a second.
export function listeningLagSeconds(): number | null {
	const audio = element;
	if (anchor === null || !audio || timelineStreamTime === null) return null;

	const liveNow = timelineStreamTime + (performance.now() - timelineAt) / 1000;
	return liveNow - (anchor + audio.currentTime);
}

// ---- diagnostics -------------------------------------------------------------

// The stream clock cannot be read off the screen, so `__jeanStream()` prints it. A null anchor means no correction is applied.
if (import.meta.env.DEV) {
	(globalThis as unknown as Record<string, unknown>).__jeanStream = () => {
		const audio = element;
		const ranges = audio?.buffered;

		return {
			phase: phase.kind,
			format,
			anchor,
			currentTime: audio?.currentTime ?? null,
			bufferedStart: audio ? bufferedStart(audio) : null,
			bufferedEnd:
				ranges && ranges.length > 0 ? ranges.end(ranges.length - 1) : null,
			lagSeconds: listeningLagSeconds(),
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
		// Both, in this order: clearing `src` alone leaves the connection open in some browsers.
		audio.removeAttribute("src");
		audio.load();
	}
}

function teardown() {
	stopStream();
	format = null;
}

export function disconnect() {
	const gone = target;
	const wasListening = isListening();

	teardown();
	setPhase({ kind: "off" });

	// Only when there was a connection to end. A closed socket says nothing about why it closed, and the component waits out a linger before unmuting the player in case it was a reconnect; this is what says it was not one.
	if (wasListening && gone) leaveStream(gone.origin, gone.token, deviceId());
}

// Idempotent, so every caller of the hook may state the target without tearing down another's connection.
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
