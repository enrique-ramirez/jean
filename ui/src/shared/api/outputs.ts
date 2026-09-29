import { ask, orNull, PROBE_TIMEOUT_MS, type Schema } from "./client";

export type Outputs = Schema["Outputs"];
export type OutputDevice = Schema["OutputDevice"];

export const fetchOutputs = (origin: string) =>
	orNull(
		ask(origin, PROBE_TIMEOUT_MS, (api, init) => api.GET("/outputs", init)),
	);
