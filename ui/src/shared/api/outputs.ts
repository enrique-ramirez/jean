import { askResult, PROBE_TIMEOUT_MS, type Schema } from "./client";

export type OutputDevice = Schema["OutputDevice"];

export const fetchOutputs = (origin: string) =>
	askResult(origin, PROBE_TIMEOUT_MS, (api, init) => api.GET("/outputs", init));
