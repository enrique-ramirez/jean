import type { PlaybackMode } from "../../src/shared/api/types.ts";
import type {
	QueuedEntry,
	RecordedRequest,
	StreamMark,
	Track,
} from "./state.ts";

export const ENGINE_SESSION_ID = "engine";

export const DETACHED_PLAYBACK_MODES: PlaybackMode[] = [
	"inOrder",
	"repeatAll",
	"repeatOne",
	"random",
	"shuffleTracks",
];

const RESTARTS_PAST_SECONDS = 3;
const KEPT_REPORTS = 8;

export interface SessionDevice {
	deviceId: string;
	name: string | null;
}

export type SessionReportKind = "undecodable" | "chainDropped";

export interface SessionReport {
	sequence: number;
	kind: SessionReportKind;
	track: Track;
}

export interface SessionNeeds {
	evaluate: (track: Track, expression: string) => string;
	marksKept: number;
}

type Intent = "stopped" | "paused" | "playing";

interface ListeningDevice {
	name: string | null;
	format: string;
	connections: number;
	sinceMs: number;
}

let minted = 0;

const mintId = () => {
	minted += 1;
	return `${minted.toString(36)}${Math.random().toString(36).slice(2, 10)}`;
};

function detachedSession(
	id: string,
	createdBy: SessionDevice,
	{ evaluate, marksKept }: SessionNeeds,
	leaveLanded: () => void,
) {
	let shared = false;
	const members = new Set([createdBy.deviceId]);
	const leftWhileHeard = new Set<string>();
	const roster = new Map<string, ListeningDevice>();
	const hangUps = new Set<() => void>();
	let anonymous = 0;

	let snapshot: Track[] = [];
	let row = -1;
	let playing: Track | null = null;
	let playingQueued = false;
	let intent: Intent = "stopped";
	let position = { seconds: 0, takenAtMs: Date.now() };
	let mode: PlaybackMode = "inOrder";
	let queue: Track[] = [];
	let queueRevision = 0;
	let marks: StreamMark[] = [];
	let timelineRevision = 0;
	let reports: SessionReport[] = [];
	let reported = 0;
	let chainDropped = false;
	let sessionRevision = 0;
	let version = 0;

	const playback = (): Intent =>
		intent === "playing" && roster.size === 0 ? "paused" : intent;

	const markPosition = (seconds: number) => {
		position = { seconds, takenAtMs: Date.now() };
	};

	const duration = () =>
		playing ? Number(evaluate(playing, "%length_seconds%")) || 0 : 0;

	// `PlayerState.playback` in `contract/openapi.yaml`: a session set to play reads `paused` while no
	// connection listens, and its position stands still from that moment, as a pause does.
	const changingAudience = (change: () => void) => {
		const before = playback();
		change();
		if (playback() === before) return;
		markPosition(position.seconds);
		version += 1;
	};

	const layMark = (track: Track, at: number) => {
		marks = [
			...marks.slice(1 - marksKept),
			{
				atMs: Date.now(),
				path: String(evaluate(track, "%path%")),
				subsong: Number(track["%subsong%"]) || 0,
				position: at,
			},
		];
		timelineRevision += 1;
	};

	const start = (track: Track, fromQueue: boolean) => {
		playing = track;
		playingQueued = fromQueue;
		intent = "playing";
		markPosition(0);
		layMark(track, 0);
		version += 1;
	};

	const startRow = (next: number) => {
		row = next;
		start(snapshot[row], false);
	};

	const startQueued = () => {
		const queued = queue.shift();
		if (!queued) return false;
		queueRevision += 1;
		start(queued, true);
		return true;
	};

	const rowBefore = () =>
		mode === "repeatAll" || mode === "repeatOne"
			? (row - 1 + snapshot.length) % snapshot.length
			: Math.max(row - 1, 0);

	const pause = () => {
		if (intent !== "playing") return;
		intent = "paused";
		markPosition(position.seconds);
		version += 1;
	};

	const resume = () => {
		if (intent === "stopped") {
			if (!startQueued() && row >= 0) startRow(row);
			return;
		}
		if (intent === "playing") return;
		intent = "playing";
		markPosition(position.seconds);
		version += 1;
	};

	const queueMoved = () => {
		queueRevision += 1;
		version += 1;
	};

	const report = (kind: SessionReportKind, track: Track) => {
		reported += 1;
		reports = [...reports, { sequence: reported, kind, track }].slice(
			-KEPT_REPORTS,
		);
		if (kind === "chainDropped") chainDropped = true;
		sessionRevision += 1;
		version += 1;
	};

	return {
		id,
		createdBy,
		get shared() {
			return shared;
		},
		playback,
		playingTrack: () => playing,
		get position() {
			return position;
		},
		duration,
		get mode() {
			return mode;
		},
		get queueRevision() {
			return queueRevision;
		},
		get timelineRevision() {
			return timelineRevision;
		},
		get sessionRevision() {
			return sessionRevision;
		},
		get version() {
			return version;
		},
		get marks() {
			return marks;
		},
		get reports() {
			return reports;
		},
		get chainDropped() {
			return chainDropped;
		},

		sees: (deviceId: string) => shared || members.has(deviceId),

		join(deviceId: string) {
			if (deviceId) members.add(deviceId);
		},

		leave(deviceId: string) {
			if (roster.has(deviceId)) leftWhileHeard.add(deviceId);
			else members.delete(deviceId);
		},

		get kept() {
			return members.size > 0 || roster.size > 0;
		},

		share(next: boolean) {
			if (next === shared) return;
			shared = next;
			sessionRevision += 1;
			version += 1;
		},

		// One connection. `contract/openapi.yaml` makes each anonymous connection a device of its own,
		// and never a member.
		listen(device: SessionDevice | null, format: string, hangUp?: () => void) {
			const named = device?.deviceId ?? "";
			if (named) members.add(named);
			else anonymous += 1;
			leftWhileHeard.delete(named);
			const deviceId = named || `#${anonymous}`;
			changingAudience(() => {
				const held = roster.get(deviceId);
				if (held) held.connections += 1;
				else
					roster.set(deviceId, {
						name: device?.name ?? null,
						format,
						connections: 1,
						sinceMs: Date.now(),
					});
			});
			if (hangUp) hangUps.add(hangUp);

			let open = true;
			return {
				close() {
					if (!open) return;
					open = false;
					if (hangUp) hangUps.delete(hangUp);
					changingAudience(() => {
						const held = roster.get(deviceId);
						if (!held) return;
						if (held.connections > 1) held.connections -= 1;
						else roster.delete(deviceId);
					});
					if (roster.has(deviceId) || !leftWhileHeard.delete(deviceId)) return;
					members.delete(deviceId);
					leaveLanded();
				},
			};
		},

		roster: () =>
			[...roster].map(([deviceId, held]) => ({
				deviceId,
				name: held.name,
				format: held.format,
				connections: held.connections,
				listeningFor: Math.floor((Date.now() - held.sinceMs) / 1000),
			})),

		connections: () =>
			[...roster.values()].reduce((total, held) => total + held.connections, 0),

		hangUp() {
			for (const hangUp of [...hangUps]) hangUp();
		},

		play(tracks: Track[], index: number) {
			snapshot = [...tracks];
			startRow(index);
		},

		playPause() {
			if (playback() === "playing") pause();
			else if (intent !== "playing") resume();
		},

		pause,
		resume,

		next() {
			if (startQueued() || snapshot.length === 0) return;
			startRow((row + 1) % snapshot.length);
		},

		previous() {
			if (playing && position.seconds > RESTARTS_PAST_SECONDS)
				return start(playing, playingQueued);
			if (snapshot.length === 0) return;
			startRow(playingQueued ? row : rowBefore());
		},

		stop() {
			if (intent === "stopped") return;
			intent = "stopped";
			playing = null;
			playingQueued = false;
			markPosition(0);
			version += 1;
		},

		seek({
			seconds,
			relativeSeconds = 0,
		}: {
			seconds?: number;
			relativeSeconds?: number;
		}) {
			if (!playing) return;
			const to =
				seconds ??
				Math.min(Math.max(position.seconds + relativeSeconds, 0), duration());
			markPosition(to);
			layMark(playing, to);
			version += 1;
		},

		setMode(next: PlaybackMode) {
			if (next === mode) return;
			mode = next;
			version += 1;
		},

		// `contract/openapi.yaml`: a session holds what it queued by handle, never by a playlist row.
		queuedEntries: () =>
			queue.map((track) => ({ playlistId: null, track, index: -1 })),

		queueInsert(entries: QueuedEntry[], at?: number) {
			if (entries.length === 0) return;
			queue.splice(
				at ?? queue.length,
				0,
				...entries.map((entry) => entry.track),
			);
			queueMoved();
		},

		queueMove(from: number, to: number) {
			if (from === to) return;
			const [track] = queue.splice(from, 1);
			queue.splice(to, 0, track);
			queueMoved();
		},

		queueRemoveAt(index: number) {
			queue.splice(index, 1);
			queueMoved();
		},

		queueClear() {
			if (queue.length === 0) return;
			queue = [];
			queueMoved();
		},

		report,

		dropChain() {
			if (chainDropped) return;
			if (!playing)
				throw new Error(
					`fake fooJean: session ${id} plays nothing, so it has no chain to drop`,
				);
			report("chainDropped", playing);
		},
	};
}

export type DetachedSession = ReturnType<typeof detachedSession>;

export function createSessions(needs: SessionNeeds) {
	const held = new Map<string, DetachedSession>();

	const end = (session: DetachedSession) => {
		if (!held.delete(session.id)) return;
		session.hangUp();
	};

	return {
		get count() {
			return held.size;
		},

		create(createdBy: SessionDevice) {
			const session: DetachedSession = detachedSession(
				mintId(),
				createdBy,
				needs,
				() => {
					if (!session.kept) end(session);
				},
			);
			held.set(session.id, session);
			return session;
		},

		list: () => [...held.values()],

		find: (id: string) => held.get(id) ?? null,

		visible(id: string, deviceId: string) {
			const session = held.get(id);
			return session?.sees(deviceId) ? session : null;
		},

		leave(session: DetachedSession, deviceId: string) {
			session.leave(deviceId);
			if (!session.kept) end(session);
		},

		end,

		connections: () =>
			[...held.values()].reduce(
				(total, session) => total + session.connections(),
				0,
			),
	};
}

// `contract/openapi.yaml`'s `Session` parameter: no `session`, an empty one and `engine` are one
// request, to the player's own session.
const sessionNamedBy = (session: string | null) => session || ENGINE_SESSION_ID;

export const postsToSession = (
	requests: RecordedRequest[],
	route: string,
	session: string,
) =>
	requests.filter((entry) => {
		if (entry.method !== "POST") return false;
		const url = new URL(entry.path, "http://fake");
		return (
			url.pathname === route &&
			sessionNamedBy(url.searchParams.get("session")) ===
				sessionNamedBy(session)
		);
	}).length;
