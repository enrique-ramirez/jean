import { askResult, PROBE_TIMEOUT_MS, type Schema } from "./client";

export type ComponentStatus = Schema["Status"];

export const fetchStatus = (origin: string) =>
	askResult(origin, PROBE_TIMEOUT_MS, (api, init) => api.GET("/status", init));
