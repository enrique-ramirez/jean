import { ask, PROBE_TIMEOUT_MS, type Schema } from "./client";
import type { DeviceIdentity } from "./stream";

export type SessionDocument = Schema["Session"];
export type SessionReport = Schema["SessionReport"];

export const createSession = (origin: string, device: DeviceIdentity) =>
	ask(origin, PROBE_TIMEOUT_MS, (api, init) =>
		api.POST("/sessions", { ...init, body: device }),
	);

export const listSessions = (origin: string, deviceId: string) =>
	ask(origin, PROBE_TIMEOUT_MS, (api, init) =>
		api.GET("/sessions", { ...init, params: { query: { deviceId } } }),
	);

export const readSession = (origin: string, id: string, deviceId: string) =>
	ask(origin, PROBE_TIMEOUT_MS, (api, init) =>
		api.GET("/sessions/{id}", {
			...init,
			params: { path: { id }, query: { deviceId } },
		}),
	);

export const shareSession = (
	origin: string,
	id: string,
	deviceId: string,
	shared: boolean,
) =>
	ask(origin, PROBE_TIMEOUT_MS, (api, init) =>
		api.POST("/sessions/{id}", {
			...init,
			params: { path: { id }, query: { deviceId } },
			body: { shared },
		}),
	);
