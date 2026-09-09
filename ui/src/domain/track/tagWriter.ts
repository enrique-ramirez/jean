import {
	discoverFooJean,
	type FooJeanDiscovery,
	type FooJeanState,
	type WriteResult,
	writeTags,
} from "@/shared/api/fooJean";
import type { TrackIdentity } from "@/shared/api/types";
import { translate } from "@/shared/i18n/locale";

// Nothing outside this file may ask which implementation it is holding.
export interface TagWriter {
	kind: "none" | "agent";
	canWrite: boolean;
	// Compared case-insensitively, so callers ask `allows()` rather than reading this directly.
	allowedFields: string[];
	allows: (field: string) => boolean;
	write: (
		track: TrackIdentity,
		fields: Record<string, string>,
	) => Promise<WriteResult>;
}

// `write` answers rather than throwing, so no caller needs to know which writer it holds.
export const NO_WRITER: TagWriter = {
	kind: "none",
	canWrite: false,
	allowedFields: [],
	allows: () => false,
	write: async () => ({
		ok: false,
		reason: "unavailable",
		message: translate("tagWrite.unavailable"),
	}),
};

const agentWriter = (
	origin: string,
	token: string,
	allowedFields: string[],
): TagWriter => {
	const allowed = new Set(allowedFields.map((field) => field.toLowerCase()));

	return {
		kind: "agent",
		canWrite: allowed.size > 0,
		allowedFields,
		allows: (field) => allowed.has(field.toLowerCase()),
		write: async (track, fields) => {
			if (!track.path)
				return {
					ok: false,
					reason: "unknown-track",
					message: translate("tagWrite.noPath"),
				};
			return writeTags(origin, token, {
				path: track.path,
				// Omitted rather than sent as 0; an ordinary file has no subsong.
				...(track.subsong ? { subsong: track.subsong } : null),
				fields,
			});
		},
	};
};

export const withoutField = (writer: TagWriter, field: string): TagWriter => {
	const remaining = writer.allowedFields.filter(
		(name) => name.toLowerCase() !== field.toLowerCase(),
	);
	if (remaining.length === writer.allowedFields.length) return writer;
	if (writer.kind !== "agent") return writer;

	const allowed = new Set(remaining.map((name) => name.toLowerCase()));
	return {
		...writer,
		canWrite: allowed.size > 0,
		allowedFields: remaining,
		allows: (name) => allowed.has(name.toLowerCase()),
	};
};

export type TagWriterState = FooJeanState;

export interface TagWriterResolution {
	state: TagWriterState;
	writer: TagWriter;
}

export function tagWriterOf({
	state,
	origin,
	token,
}: FooJeanDiscovery): TagWriterResolution {
	if (state.kind !== "ready" || !origin || !token)
		return { state, writer: NO_WRITER };
	return {
		state,
		writer: agentWriter(origin, token, state.capabilities.allowedFields),
	};
}

export const resolveTagWriter = async (token: string | null) =>
	tagWriterOf(await discoverFooJean(token));
