import {
	type DiscoveryRecord,
	type FooJeanCapabilities,
	type FooJeanStatus,
	fetchCapabilities,
	fetchDiscoveryRecord,
	originOfPort,
	probeStatus,
	type WriteResult,
	writeTags,
} from "@/shared/api/fooJean";
import type { TrackIdentity } from "@/shared/api/types";

// Where a tag write goes: nowhere, or `foo_jean`. Nothing outside this file may
// ask which; see the root CLAUDE.md.

export interface TagWriter {
	kind: "none" | "agent";
	canWrite: boolean;
	// Compared case-insensitively, so callers ask `allows()` rather than reading
	// this directly.
	allowedFields: string[];
	allows: (field: string) => boolean;
	write: (
		track: TrackIdentity,
		fields: Record<string, string>,
	) => Promise<WriteResult>;
}

// `write` answers rather than throwing: a caller that had to guard would be a
// caller that knows which writer it holds.
export const NO_WRITER: TagWriter = {
	kind: "none",
	canWrite: false,
	allowedFields: [],
	allows: () => false,
	write: async () => ({
		ok: false,
		reason: "unavailable",
		message: "Tag writing is not available.",
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
					message: "That track has no path to write to.",
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

// How a field leaves the writer, whether refused by the component or switched
// off in settings. The rest of the app cannot tell the two apart.
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

// What Jean found, which is not the same as what it can do. Every one of these
// gets its own message; `features/settings/TagWriting.tsx` is the whole list.
export type TagWriterState =
	| { kind: "absent" }
	| {
			kind: "not-listening";
			record: DiscoveryRecord;
			// The component's own words, safe to show.
			error: string;
			portInUse: boolean;
	  }
	| { kind: "unreachable"; record: DiscoveryRecord }
	| { kind: "impostor"; record: DiscoveryRecord }
	| { kind: "unsupported"; record: DiscoveryRecord; apiVersion: number }
	| { kind: "no-token"; record: DiscoveryRecord; status: FooJeanStatus }
	| { kind: "unauthorized"; record: DiscoveryRecord; status: FooJeanStatus }
	| {
			kind: "ready";
			record: DiscoveryRecord;
			status: FooJeanStatus;
			capabilities: FooJeanCapabilities;
	  };

export interface TagWriterResolution {
	state: TagWriterState;
	writer: TagWriter;
}

// **The order is the security model**: read the hint, prove the port with an
// unauthenticated call, and only then attach the token. Skipping the middle step
// hands a credential to whoever forged the record.
export async function resolveTagWriter(
	token: string | null,
): Promise<TagWriterResolution> {
	const record = await fetchDiscoveryRecord().catch(() => null);
	if (!record) return { state: { kind: "absent" }, writer: NO_WRITER };

	if (!record.listening) {
		return {
			state: {
				kind: "not-listening",
				record,
				error: record.error ?? "The component could not start.",
				portInUse: Boolean(record.portInUse),
			},
			writer: NO_WRITER,
		};
	}

	const origin = originOfPort(record.port);
	const probe = await probeStatus(origin);

	if (!probe.ok) {
		const state: TagWriterState =
			probe.reason === "unsupported"
				? { kind: "unsupported", record, apiVersion: probe.apiVersion }
				: probe.reason === "impostor"
					? { kind: "impostor", record }
					: { kind: "unreachable", record };
		return { state, writer: NO_WRITER };
	}

	const { status } = probe;
	if (!token)
		return { state: { kind: "no-token", record, status }, writer: NO_WRITER };

	const capabilities = await fetchCapabilities(origin, token);
	if (!capabilities.ok) {
		return {
			state:
				capabilities.reason === "unauthorized"
					? { kind: "unauthorized", record, status }
					: { kind: "unreachable", record },
			writer: NO_WRITER,
		};
	}

	return {
		state: {
			kind: "ready",
			record,
			status,
			capabilities: capabilities.capabilities,
		},
		writer: agentWriter(origin, token, capabilities.capabilities.allowedFields),
	};
}
