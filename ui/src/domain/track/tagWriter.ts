import { FooJeanFailed } from "@/shared/api/client";
import type { FooJeanDiscovery, FooJeanState } from "@/shared/api/discovery";
import { fetchPlaylistRows } from "@/shared/api/playlists";
import { type WriteResult, writeTags } from "@/shared/api/tags";
import { fetchLibraryTrack } from "@/shared/api/tracks";
import type { TrackAddress } from "@/shared/api/types";
import { translate } from "@/shared/i18n/locale";
import { UNRESOLVED } from "./libraryColumns";

export interface TagWriter {
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

const fooJeanWriter = (origin: string, allowedFields: string[]): TagWriter => {
	const allowed = new Set(allowedFields.map((field) => field.toLowerCase()));

	return {
		canWrite: allowed.size > 0,
		allowedFields,
		allows: (field) => allowed.has(field.toLowerCase()),
		write: async (address, fields) =>
			writeTags(origin, { ...addressFields(address), fields }),
		read: async (address, column) => {
			const answer =
				address.kind === "playlist"
					? await fetchPlaylistRows(
							origin,
							address.playlist,
							{ offset: address.index, count: 1 },
							[column],
						)
					: await fetchLibraryTrack(origin, address, [column]);
			if (!answer.ok) {
				if (answer.reason === "refused" && answer.retryInMs !== null)
					throw new FooJeanFailed(answer);
				return null;
			}
			const held =
				"items" in answer.value
					? answer.value.items[0]?.columns[0]
					: answer.value.columns[0];

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
}: FooJeanDiscovery): TagWriterResolution {
	if (state.kind !== "ready" || !origin) return { state, writer: NO_WRITER };
	return {
		state,
		writer: fooJeanWriter(origin, state.capabilities.allowedFields),
	};
}
