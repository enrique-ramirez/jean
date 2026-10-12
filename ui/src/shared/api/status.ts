import { askResult, PROBE_TIMEOUT_MS } from "./client";

export const fetchStatus = (origin: string) =>
	askResult(origin, PROBE_TIMEOUT_MS, (api, init) => api.GET("/status", init));
