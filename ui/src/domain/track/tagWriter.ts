import {
	discoverFooJean,
	type FooJeanDiscovery,
	type FooJeanState,
	fetchLibraryTrack,
	fetchPlaylistRows,
	type WriteResult,
	writeTags,
} from "@/shared/api/fooJean";
import type { TrackAddress } from "@/shared/api/types";
import { translate } from "@/shared/i18n/locale";
import { UNRESOLVED } from "./libraryColumns";

// Nothing outside this file may ask which implementation it is holding.
export interface TagWriter {
	kind: "none" | "agent";
	canWrite: boolean;
	// Compared case-insensitively, so callers ask `allows()` rather than reading this directly.
	allowedFields: string[];
	allows: (field: string) => boolean;
	write: (
		address: TrackAddress,
		fields: Record<string, string>,
	) => Promise<WriteResult>;
	read: (address: TrackAddress, column: string) => Promise<string | null>;
}

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
	read: async () => null,
};

const addressFields = (address: TrackAddress) => {
	if (address.kind === "library")
		return {
			track: address.track,
			// Omitted rather than sent as 0; an ordinary file has no subsong.
			...(address.subsong ? { subsong: address.subsong } : null),
		};

	if (address.kind === "ordinal")
		return { ordinal: address.ordinal, structure: address.structure };

	return {
		playlist: address.playlist,
		index: address.index,
		structure: address.structure,
	};
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
		write: async (address, fields) =>
			writeTags(origin, token, { ...addressFields(address), fields }),
		read: async (address, column) => {
			// `GET /api/library/track` names a track by the path form, so a write sent by an ordinal
			// has no route to be read back through.
			if (address.kind === "ordinal") return null;

			const held = await (address.kind === "library"
				? fetchLibraryTrack(origin, token, address.track, address.subsong, [
						column,
					]).then(({ columns }) => columns[0])
				: fetchPlaylistRows(origin, token, address.playlist, address.index, 1, [
						column,
					]).then(({ items }) => items[0]?.columns[0])
			).catch(() => undefined);

			// README.md: `?` is foobar2000 saying the field is absent, never a null.
			if (held === UNRESOLVED) return "";
			return held === undefined ? null : held;
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
