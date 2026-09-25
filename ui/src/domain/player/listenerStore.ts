import {
	fetchStreamTimeline,
	issueStreamTicket,
	leaveStream,
	type StreamMark,
	streamUrl,
} from "@/shared/api/fooJean";
import type { PlaybackState } from "@/shared/api/types";
import { translate } from "@/shared/i18n/locale";
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
	playsNatively,
} from "./listener";
import { canUseMse, type MseStream, openMseStream } from "./mseStream";

const VOLUME_KEY = "jean.listenVolume";
export const LOW_LATENCY_KEY = "jean.lowLatencyStream";

const RECONNECT_MS = [500, 1000, 2000, 4000, 8000];
const BUSY_RETRY_MS = 5000;
// How long `currentTime` may stand still while the element believes it is playing. A dead live
// stream fires `stalled` and `waiting`, never `error`, so nothing else notices.
const STALL_MS = 6000;
const START_MS = 25_000;
const SEEK_WAIT_MS = 20_000;
const WATCHDOG_MS = 1000;
const STALLS_ALLOWED = 3;
const STALL_WINDOW_MS = 30_000;
const AFTER_FLUSH_MS = 3000;
const MSE_START_MS = 5000;
const TIMELINE_POLL_MS = 10_000;

// A stopped player and a broken stream look identical from the stream: headers arrive and then
// nothing. Only the player's own state can say which, and the two need different sentences.
export type ListenPhase =
	| { kind: "off" }
	| { kind: "connecting" }
	| { kind: "playing" }
	| { kind: "reconnecting"; attempt: number }
	| { kind: "blocked" }
	| { kind: "busy"; message: string }
	| { kind: "silent" }
	| { kind: "failed"; message: string };

export interface ListenSnapshot {
	phase: ListenPhase;
	format: string | null;
	volumeDb: number;
	isMuted: boolean;
	// False on iOS, where `audio.volume` is a documented no-op.
	canSetVolume: boolean;
	audiblePath: string | null;
	// True once this connection has given up on the short buffer. The stored preference is left
	// alone: it says what to try, and this says what happened.
	lowLatencyFellBack: boolean;
}

const listeners = subscribers();

let element: HTMLAudioElement | null = null;
let target: ListenTarget | null = null;
let format: string | null = null;
let phase: ListenPhase = { kind: "off" };
let volumeDb = readStoredVolume();
let isMuted = false;
let canSetVolume = true;

const dead = new Set<string>();

let attempt = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let watchdogTimer: ReturnType<typeof setInterval> | null = null;
let timelineTimer: ReturnType<typeof setInterval> | null = null;

let anchor: number | null = null;
let timelineStreamTime: number | null = null;
let timelineAt = 0;
let connectAt = 0;
let marks: StreamMark[] = [];
let audiblePath: string | null = null;
let pendingSeek: number | null = null;
let mse: MseStream | null = null;
let lowLatencyFellBack = false;
let stalls: number[] = [];
let flushedAt = 0;
let pendingMarkAt = 0;
let pendingAt = 0;
let lastTime = 0;
let lastAdvance = 0;
let hasRendered = false;
let knownPlaybackState: PlaybackState | null = null;
// Bumps on every connect, so a ticket or timeline settling after its connection was torn down is
// discarded.
let generation = 0;

let snapshot: ListenSnapshot = build();

function build(): ListenSnapshot {
	return {
		phase,
		format,
		volumeDb,
		isMuted,
		canSetVolume,
		audiblePath,
		lowLatencyFellBack,
	};
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
export const listeningServerSnapshot = () => snapshot;

// Fed by the poll; see ../../ARCHITECTURE.md, `["player"]`, for why the stall check below reads
// this rather than asking `foo_jean` itself.
export const notePlaybackState = (state: PlaybackState) => {
	knownPlaybackState = state;
};

export const isListening = (at: ListenPhase) =>
	at.kind !== "off" && at.kind !== "failed";

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
	audio.addEventListener("waiting", onWaiting);
	audio.addEventListener("timeupdate", onTimeUpdate);
	audio.addEventListener("error", onError);
	audio.addEventListener("ended", onEnded);

	// In the document, though it draws nothing: browsers only treat an attached element as the page's
	// media for the OS controls.
	audio.hidden = true;
	document.body.appendChild(audio);

	element = audio;
	return audio;
}

// Ogg is not an MSE container anywhere, so the low-latency path demuxes it and re-wraps the same
// Opus packets in WebM. AAC has no such path, which is why the format decides too.
function wantsLowLatency(forFormat: string) {
	if (forFormat !== "opus" || !canUseMse() || lowLatencyFellBack) return false;
	try {
		return localStorage.getItem(LOW_LATENCY_KEY) !== "false";
	} catch {
		return false;
	}
}

// An orphan keeps its reader loop and its object URL, goes on pulling the live stream at 1x, still
// counts against `maxConcurrentStreams`, and drives reconnects on a connection it no longer owns.
function releaseStream() {
	mse?.stop();
	mse = null;
}

function sourceFor(
	audio: HTMLAudioElement,
	origin: string,
	ticket: string,
	forFormat: string,
) {
	const url = streamUrl(origin, ticket, forFormat);
	if (!wantsLowLatency(forFormat)) return url;

	mse = openMseStream(url, audio, {
		onReady: () => {
			if (audio.paused) void audio.play().catch(() => undefined);
		},
		onError: () => {
			if (isListening(phase)) scheduleReconnect();
		},
		onUnusable: retireLowLatency,
	});
	return mse.src;
}

// Retiring the remux can retire a format with it: where the element cannot play the container the
// component sent, the remux was the only way to reach that format.
function retireLowLatency() {
	lowLatencyFellBack = true;
	stalls = [];
	if (format && !playsNatively(format)) dead.add(format);
	restartListening();
}

// A flush empties the buffer deliberately and the first fill is not a stall, so neither is counted.
function onWaiting() {
	if (!mse || !hasRendered) return;
	if (performance.now() - flushedAt < AFTER_FLUSH_MS) return;

	const now = performance.now();
	stalls = stalls.filter((at) => now - at < STALL_WINDOW_MS);
	stalls.push(now);
	if (stalls.length < STALLS_ALLOWED) return;

	retireLowLatency();
}

function markRendered(at: number) {
	lastTime = at;
	lastAdvance = performance.now();
	hasRendered = true;
}

function onPlaying() {
	if (!isListening(phase)) return;
	attempt = 0;
	setPhase({ kind: "playing" });
	markRendered(element?.currentTime ?? 0);
	deriveAnchor();
}

function hasReachedSeek(mark: StreamMark | null) {
	return (
		(mark !== null && mark.at > pendingMarkAt) ||
		performance.now() - pendingAt > SEEK_WAIT_MS
	);
}

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

// `error.code` is the only thing separating "cannot play this" from "the Wi-Fi dropped", and the two
// want opposite responses.
function onError() {
	if (!isListening(phase)) return;
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
	if (isListening(phase)) scheduleReconnect();
}

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
		// Deliberately vague: a refused ticket and an undecodable codec reach the element as the same
		// `MEDIA_ERR`.
		setPhase({
			kind: "failed",
			message: translate("listen.cannotPlay"),
		});
		return;
	}
	void open(remaining[0]);
}

function forgetStreamClock() {
	anchor = null;
	timelineStreamTime = null;
	marks = [];
	audiblePath = null;
	pendingSeek = null;
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

// Re-entered by the reconnect timer, the busy retry and the codec fall-through as well as by a fresh
// connect, so everything a connection holds is released here rather than in `stopStream`.
async function open(next: string) {
	if (!target) return;

	const mine = ++generation;
	releaseStream();
	format = next;
	forgetStreamClock();
	stalls = [];
	setPhase(
		attempt > 0 ? { kind: "reconnecting", attempt } : { kind: "connecting" },
	);

	const issued = await issueStreamTicket(target.origin, deviceIdentity());
	if (mine !== generation) return;

	if (!issued.ok) {
		if (issued.reason === "busy") {
			setPhase({ kind: "busy", message: issued.message });
			if (reconnectTimer) clearTimeout(reconnectTimer);
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
	audio.src = sourceFor(audio, target.origin, issued.ticket.ticket, next);
	audio.volume = amplitudeOf(volumeDb);

	startWatchdog();
	void reloadMarks();

	try {
		await audio.play();
	} catch (error) {
		if (mine !== generation) return;
		// `play()` after an await has lost its user gesture. The only fix is a control the user presses
		// synchronously.
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
			message: translate("listen.keepsDropping"),
		});
		return;
	}

	const wait = RECONNECT_MS[attempt];
	attempt += 1;
	setPhase({ kind: "reconnecting", attempt });
	// Never open a second element to probe with: Safari holds two connections per listener, and
	// `maxConcurrentStreams` counts connections.
	const mine = generation;
	reconnectTimer = setTimeout(() => {
		if (mine !== generation) return;
		const remaining = liveFormats();
		if (remaining.length > 0) void open(format ?? remaining[0]);
	}, wait);
}

// A reconnect is a new connection and the observation has to restart whether or not the interval
// does: left alone, it inherits `hasRendered` and neither the slow-start grace nor the short-buffer
// write-off can fire again.
function startWatchdog() {
	lastTime = 0;
	lastAdvance = performance.now();
	hasRendered = false;

	if (watchdogTimer) return;
	watchdogTimer = setInterval(watch, WATCHDOG_MS);
	timelineTimer = setInterval(() => void refreshTimeline(), TIMELINE_POLL_MS);
}

function watch() {
	const audio = element;
	if (!audio || !isListening(phase)) return;
	if (phase.kind === "blocked" || phase.kind === "busy") return;

	// Nothing has been heard and the short-buffer path had its chance. The stall counter cannot cover
	// this: it needs a first sample to tell a stream running dry from one that never started.
	if (mse && !hasRendered && performance.now() - connectAt > MSE_START_MS) {
		retireLowLatency();
		return;
	}

	if (audio.currentTime !== lastTime) {
		markRendered(audio.currentTime);
		if (phase.kind === "silent") setPhase({ kind: "playing" });
		return;
	}

	if (audio.paused) return;
	if (performance.now() - lastAdvance < STALL_MS) return;

	if (knownPlaybackState !== null && knownPlaybackState !== "playing") {
		setPhase({ kind: "silent" });
		lastAdvance = performance.now();
		return;
	}

	if (!hasRendered && performance.now() - lastAdvance < START_MS) return;

	scheduleReconnect();
}

// Retried from `playing`, from every `timeupdate` and from every poll: the two terms arrive in
// either order.
function deriveAnchor() {
	if (anchor !== null || timelineStreamTime === null || !element) return;

	// On the low-latency path the muxer's own clock starts at zero on connect, so the origin is known
	// rather than measured. Read from `buffered` it would be a race: the trim moves `start(0)`
	// forward every few seconds.
	const origin = mse ? 0 : bufferedStart(element);
	if (origin === null) return;

	const atConnect = timelineStreamTime - (timelineAt - connectAt) / 1000;
	anchor = anchorOf(atConnect, origin);
}

async function reloadMarks() {
	if (!target || !element || !isListening(phase)) return;

	const mine = generation;
	const timeline = await fetchStreamTimeline(target.origin);
	if (!timeline || mine !== generation || !element) return;

	marks = timeline.marks;
	timelineStreamTime = timeline.streamTime;
	timelineAt = performance.now();
	deriveAnchor();
}

export const refreshTimeline = () => void reloadMarks();

export function listeningPosition(
	path: string | null | undefined,
	duration: number,
): number | null {
	if (!element || phase.kind !== "playing") return null;
	if (pendingSeek !== null) return pendingSeek;
	return audiblePosition(anchor, marks, element.currentTime, path, duration);
}

export function beginSeek(position: number) {
	if (!isListening(phase) || !element) return;

	if (mse) {
		flushedAt = performance.now();
		mse.flush();
	}

	pendingSeek = position;
	pendingMarkAt =
		audibleMark(anchor, marks, element.currentTime)?.at ??
		Number.NEGATIVE_INFINITY;
	pendingAt = performance.now();
}

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

export const listenTarget = () => target;

export function listeningLagSeconds(): number | null {
	const audio = element;
	if (anchor === null || !audio || timelineStreamTime === null) return null;

	const liveNow = timelineStreamTime + (performance.now() - timelineAt) / 1000;
	return liveNow - (anchor + audio.currentTime);
}

if (import.meta.env?.DEV) {
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

function stopStream() {
	generation += 1;
	if (reconnectTimer) clearTimeout(reconnectTimer);
	if (watchdogTimer) clearInterval(watchdogTimer);
	if (timelineTimer) clearInterval(timelineTimer);
	reconnectTimer = null;
	watchdogTimer = null;
	timelineTimer = null;
	forgetStreamClock();

	releaseStream();

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
	const wasListening = isListening(phase);

	teardown();
	setPhase({ kind: "off" });

	// A closed socket says nothing about why it closed, and the component waits out a linger before
	// unmuting the player in case it was a reconnect. This is what says it was not one.
	if (wasListening && gone) leaveStream(gone.origin, deviceId());
}

export function configureListening(next: ListenTarget | null) {
	const same =
		target?.origin === next?.origin &&
		target?.formats.join() === next?.formats.join();
	if (same) return;

	if (isListening(phase)) disconnect();
	target = next;
	dead.clear();
}

// The source is chosen when a connection opens, so a change to `LOW_LATENCY_KEY` takes effect only
// through this.
export function restartListening() {
	if (!isListening(phase)) return;
	const wanted =
		format && !dead.has(format) ? format : (liveFormats()[0] ?? null);
	stopStream();
	attempt = 0;
	if (wanted) void open(wanted);
	else setPhase({ kind: "failed", message: translate("listen.noDecoder") });
}
