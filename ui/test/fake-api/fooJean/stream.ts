import {
	AAC_SAMPLE_RATE,
	AAC_SAMPLES_PER_FRAME,
	AAC_TONE,
	adtsFrames,
} from "../aacTone.ts";
import { empty, json, type Responder } from "../http.ts";
import type { DetachedSession, SessionDevice } from "../sessions.ts";
import type { StreamMark } from "../state.ts";
import { NO_SUCH_SESSION, notFound } from "./answers.ts";
import { offersStream } from "./connection.ts";
import { ANONYMOUS, labelOf, readDeviceIdentity } from "./deviceIdentity.ts";
import type { FooJeanFake } from "./options.ts";
import type { Asked, FakeState } from "./request.ts";

interface TicketHolder extends SessionDevice {
	session: string | null;
}

// The device an <audio> element belongs to and the session it hears, remembered
// from the request that minted its ticket: the element itself sends no body and
// no header.
const ticketHolders = new Map<string, TicketHolder>();

const tickets = new Set<string>();
let ticketSeq = 0;
// Bounded the way the component bounds it: keep the last few, evict the oldest.
// The count is opaque from here; treat it as the component's own choice, not a
// number to tune.
const TICKET_LIMIT = 16;
const TICKET_SECONDS = 120;

const issue = (holder: TicketHolder) => {
	ticketSeq += 1;
	const ticket = `t${ticketSeq}`;
	tickets.add(ticket);
	ticketHolders.set(ticket, holder);
	if (tickets.size > TICKET_LIMIT)
		tickets.delete(tickets.values().next().value as string);
	return { ticket, expiresIn: TICKET_SECONDS };
};

const SAMPLE_RATE = 8000;
const BYTES_PER_SECOND = SAMPLE_RATE * 2;
// Declared in the header and never actually sent: the response is chunked and
// ends when the client leaves. A browser reads until the socket closes.
const DECLARED_SECONDS = 3600;

// Real playable bytes, in a codec neither `streamFormats` names: the browser has
// to render `currentTime` against something, and the decoder is not under test.
function wavHeader() {
	const data = DECLARED_SECONDS * BYTES_PER_SECOND;
	const header = new Uint8Array(44);
	const view = new DataView(header.buffer);
	const ascii = (text: string, at: number) => {
		for (let index = 0; index < text.length; index += 1)
			header[at + index] = text.charCodeAt(index);
	};
	ascii("RIFF", 0);
	view.setUint32(4, 36 + data, true);
	ascii("WAVEfmt ", 8);
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true); // PCM
	view.setUint16(22, 1, true); // mono
	view.setUint32(24, SAMPLE_RATE, true);
	view.setUint32(28, BYTES_PER_SECOND, true);
	view.setUint16(32, 2, true);
	view.setUint16(34, 16, true);
	ascii("data", 36);
	view.setUint32(40, data, true);
	return header;
}

// A quiet tone rather than digital silence: some decoders shortcut a run of
// zeroes and `currentTime` then does not advance.
function tone(seconds: number, phase: number) {
	const samples = SAMPLE_RATE * seconds;
	const buffer = new Int16Array(samples);
	for (let at = 0; at < samples; at += 1)
		buffer[at] = Math.round(
			Math.sin(((phase + at) * 2 * Math.PI * 440) / SAMPLE_RATE) * 600,
		);
	return new Uint8Array(buffer.buffer);
}

const PRERUN_MS = 60_000;
const startedAt = Date.now() - PRERUN_MS;

const streamTimeNow = () => (Date.now() - startedAt) / 1000;

const onStreamClock = (marks: StreamMark[]) =>
	marks.map((entry) => ({
		at: Math.max(0, (entry.atMs - startedAt) / 1000),
		path: entry.path,
		subsong: entry.subsong,
		position: entry.position,
	}));

const sessionTimelineOf = (session: DetachedSession) => ({
	streamTime: streamTimeNow(),
	marks: onStreamClock(session.marks),
});

function timelineOf(state: FakeState) {
	const streamTime = streamTimeNow();

	if (state.streamMarks.length > 0)
		return { streamTime, marks: onStreamClock(state.streamMarks) };

	const item = state.player.activeItem;
	const playlist = item.index >= 0 ? state.playlistById(item.playlistId) : null;
	const track = playlist?.items[item.index];
	if (!track) return { streamTime, marks: [] };

	return {
		streamTime,
		marks: [
			{
				at: Math.max(0, streamTime - item.position),
				path: String(track["%path%"] ?? ""),
				subsong: 0,
				position: 0,
			},
		],
	};
}

interface StreamSource {
	contentType: string;
	header: Uint8Array;
	take: (seconds: number) => Uint8Array;
}

function wavSource(): StreamSource {
	let phase = 0;
	return {
		contentType: "audio/wav",
		header: wavHeader(),
		take: (seconds) => {
			const bytes = tone(seconds, phase);
			phase += SAMPLE_RATE * seconds;
			return bytes;
		},
	};
}

// WebKit refuses an endless WAV, where Chromium plays it, so `aac` gets the real
// framing.
function aacSource(): StreamSource {
	const frames = adtsFrames(AAC_TONE);
	const framesPerSecond = AAC_SAMPLE_RATE / AAC_SAMPLES_PER_FRAME;
	let next = 0;
	let owed = 0;
	return {
		contentType: "audio/aac",
		header: new Uint8Array(0),
		take: (seconds) => {
			owed += seconds * framesPerSecond;
			const taken: Uint8Array[] = [];
			for (; owed >= 1; owed -= 1) {
				taken.push(frames[next]);
				next = (next + 1) % frames.length;
			}
			const bytes = new Uint8Array(
				taken.reduce((sum, frame) => sum + frame.length, 0),
			);
			let at = 0;
			for (const frame of taken) {
				bytes.set(frame, at);
				at += frame.length;
			}
			return bytes;
		},
	};
}

function serveStream(
	response: Responder,
	fake: FooJeanFake,
	format: string,
	isPlaying: () => boolean,
) {
	const source = !fake.playableFormats.includes(format)
		? null
		: format === "aac"
			? aacSource()
			: wavSource();
	const unplayableType = format === "aac" ? "audio/aac" : "audio/ogg";
	response.writeHead(200, {
		"Content-Type": source?.contentType ?? unplayableType,
		"Cache-Control": "no-store",
		"Accept-Ranges": "none",
		// No explicit `Transfer-Encoding`: setting it by hand tells Node the handler
		// is doing its own chunk framing, and it then writes the bytes raw into a
		// response the client is still parsing as chunked. Node adds the header
		// itself when there is no `Content-Length`.
	});

	// A format the element cannot play. The bytes must arrive as the declared type,
	// so the element fails with `MEDIA_ERR_SRC_NOT_SUPPORTED` rather than stalling.
	if (!source) {
		response.write("this is not audio, and never was.\n");
		return response.end();
	}

	response.write(source.header);

	if (fake.streamBehaviour === "quiet") return;

	// See test/README.md for the `12 - prime` arithmetic this rests on.
	const PRIME_SECONDS = fake.streamBehaviour === "ok" ? fake.streamPrime : 1;
	response.write(source.take(PRIME_SECONDS));

	if (fake.streamBehaviour === "short") return response.end();

	// The component writes nothing while the player is paused or stopped, so the
	// listener runs dry rather than hearing silence.
	const pump = setInterval(() => {
		if (response.writableEnded) return clearInterval(pump);
		if (!isPlaying()) return;
		response.write(source.take(0.25));
	}, 250);

	response.on("close", () => clearInterval(pump));
}

export const engineRoster = (state: FakeState, fake: FooJeanFake) => [
	...state.streamDevices.values(),
	...fake.otherListeners.map((device) => ({
		deviceId: device.deviceId,
		name: device.name,
		format: device.format ?? "opus",
		connections: device.connections ?? 1,
		listeningFor: device.listeningFor ?? 0,
	})),
];

// One `maxConcurrentStreams` bounds every session's sockets together, so each roster counts them all.
const connectionsOf = (state: FakeState, fake: FooJeanFake) =>
	engineRoster(state, fake).reduce(
		(total, device) => total + device.connections,
		0,
	) + state.sessions.connections();

export function handleStream({
	state,
	fake,
	method,
	path,
	url,
	body,
	bodyBytes,
	response,
	session,
	named,
	namesDetached,
}: Asked) {
	// No bearer token, because an `<audio>` element cannot send a header. The
	// ticket is the credential and travels in the query string.
	if (path === "/api/stream") {
		const query = url.searchParams;
		const ticket = query.get("ticket");
		const format = query.get("format") ?? fake.streamFormats[0];

		// No ticket, an unknown one and an expired one answer identically: telling
		// them apart would let a caller sort guesses.
		if (!ticket || !tickets.has(ticket) || fake.expireTickets)
			return json(response, { error: "authentication required" }, 401);

		// A format outside the advertised list is a 400 rather than a silent
		// substitution, which would play as silence on the browser that asked.
		if (!fake.streamFormats.includes(format))
			return json(response, { error: "unsupported format" }, 400);

		const device = ticketHolders.get(ticket);
		const listenedTo = device?.session
			? state.sessions.visible(device.session, device.deviceId)
			: null;
		if (device?.session && !listenedTo)
			return json(response, NO_SUCH_SESSION, 404);

		state.streamFormats.push(format);

		state.openStreams += 1;
		state.peakStreams = Math.max(state.peakStreams, state.openStreams);
		response.on("close", () => {
			state.openStreams -= 1;
		});

		if (listenedTo) {
			const listening = listenedTo.listen(
				device?.deviceId ? device : null,
				format,
				() => response.end(),
			);
			response.on("close", () => listening.close());
			return serveStream(
				response,
				fake,
				format,
				() => listenedTo.playback() === "playing",
			);
		}

		// One device however many sockets it holds: Safari opens two, and a
		// reconnect is a third, and none of that is another person.
		if (device?.deviceId) {
			const known = state.streamDevices.get(device.deviceId);
			state.streamDevices.set(device.deviceId, {
				deviceId: device.deviceId,
				name: device.name,
				format,
				connections: (known?.connections ?? 0) + 1,
				listeningFor: known?.listeningFor ?? 0,
			});
			state.announceHold();
		}

		return serveStream(
			response,
			fake,
			format,
			() => state.player.playbackState === "playing",
		);
	}

	if (path === "/api/stream/listeners") {
		return json(response, {
			devices: session ? session.roster() : engineRoster(state, fake),
			connections: connectionsOf(state, fake),
			maxConnections: 8,
			playerMuted: state.playerHeld,
		});
	}

	if (method === "DELETE" && path === "/api/stream/hold") {
		if (!fake.canMuteWhileStreaming)
			return json(response, { error: "this install does not mute" }, 503);

		state.holdReleased = true;
		state.announceHold();
		return empty(response);
	}

	if (method === "POST" && path === "/api/stream/leave") {
		const said = (body ?? {}) as { deviceId?: string };
		if (!said.deviceId)
			return json(response, { error: "deviceId is required" }, 400);

		if (namesDetached) {
			const deviceId = labelOf(said.deviceId);
			const left = state.sessions.visible(named, deviceId);
			if (!left) return json(response, NO_SUCH_SESSION, 404);
			state.sessions.leave(left, deviceId);
			return empty(response);
		}

		state.streamDevices.delete(said.deviceId);
		// The choice to hear both outputs was scoped to the spell of listening it
		// was made in, so it goes when the last listener does.
		if (!state.playerHeld) state.holdReleased = false;
		state.announceHold();

		return empty(response);
	}

	if (method === "POST" && path === "/api/stream/ticket") {
		if (!offersStream(fake))
			return json(
				response,
				{ error: "streaming is not available on this install" },
				503,
			);

		if (fake.failTickets)
			return json(
				response,
				{ error: fake.ticketError || "stream unavailable" },
				fake.failTickets,
			);

		if (namesDetached) {
			const identity = bodyBytes === 0 ? ANONYMOUS : readDeviceIdentity(body);
			if (!identity.ok) return json(response, { error: identity.refusal }, 400);
			const { device } = identity;
			const listenedTo = state.sessions.visible(named, device.deviceId);
			if (!listenedTo) return json(response, NO_SUCH_SESSION, 404);
			listenedTo.join(device.deviceId);
			return json(response, issue({ ...device, session: listenedTo.id }));
		}

		const said = (body ?? {}) as { deviceId?: string; name?: string };
		return json(
			response,
			issue({
				deviceId: said.deviceId ?? "",
				name: said.name || null,
				session: null,
			}),
		);
	}

	if (path === "/api/stream/timeline") {
		if (!fake.canStream)
			return json(response, { error: "streaming is not available" }, 503);
		return json(
			response,
			session ? sessionTimelineOf(session) : timelineOf(state),
		);
	}

	return notFound(response);
}
