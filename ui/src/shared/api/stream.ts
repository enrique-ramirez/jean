import {
	ask,
	askResult,
	PROBE_TIMEOUT_MS,
	reach,
	refusalOf,
	type Schema,
	unreachable,
} from "./client";

export type StreamTicket = Schema["StreamTicket"];
export type StreamTimeline = Schema["StreamTimeline"];
export type StreamMark = StreamTimeline["marks"][number];
export type StreamListeners = Schema["StreamListeners"];
export type StreamListener = StreamListeners["devices"][number];
export type DeviceIdentity = Schema["DeviceIdentity"];

export type TicketFailure =
	| { ok: false; reason: "busy"; message: string }
	| { ok: false; reason: "unavailable"; message: string }
	| { ok: false; reason: "unreachable"; message: string }
	| { ok: false; reason: "gone"; message: string };

export type TicketResult = { ok: true; ticket: StreamTicket } | TicketFailure;

const isBusy = (message: string) =>
	/busy|listener|concurrent|too many/i.test(message);

const naming = (session: string | null) =>
	session === null ? {} : { params: { query: { session } } };

export async function issueStreamTicket(
	origin: string,
	device: DeviceIdentity,
	session: string | null,
): Promise<TicketResult> {
	const answer = await reach(
		ask(origin, PROBE_TIMEOUT_MS, (api, init) =>
			api.POST("/stream/ticket", { ...init, ...naming(session), body: device }),
		),
	);
	if (!answer)
		return { ok: false, reason: "unreachable", message: unreachable() };

	const { data, error, response } = answer;
	if (data) return { ok: true, ticket: data };

	const { message } = refusalOf(response, error);
	if (response.status === 503)
		return {
			ok: false,
			reason: isBusy(message) ? "busy" : "unavailable",
			message,
		};
	if (response.status === 404) return { ok: false, reason: "gone", message };
	return { ok: false, reason: "unreachable", message };
}

export const streamUrl = (origin: string, ticket: string, format: string) =>
	`${origin}/api/stream?ticket=${encodeURIComponent(ticket)}&format=${encodeURIComponent(format)}`;

export const fetchStreamTimeline = (origin: string, session: string | null) =>
	askResult(origin, PROBE_TIMEOUT_MS, (api, init) =>
		api.GET("/stream/timeline", { ...init, ...naming(session) }),
	);

export const fetchStreamListeners = (origin: string) =>
	askResult(origin, PROBE_TIMEOUT_MS, (api, init) =>
		api.GET("/stream/listeners", init),
	);

// Tells a deliberate stop from a dropped connection: both close the socket, and only this one gives
// the player its sound back now rather than after the component's linger.
export async function leaveStream(
	origin: string,
	deviceId: string,
	session: string | null,
): Promise<void> {
	await reach(
		ask(origin, PROBE_TIMEOUT_MS, (api, init) =>
			api.POST("/stream/leave", {
				...init,
				...naming(session),
				body: { deviceId },
			}),
		),
	);
}
