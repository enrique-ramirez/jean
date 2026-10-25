import { askResult, READ_TIMEOUT_MS, type Schema } from "./client";
import type { LibraryRoles } from "./libraryQuestions";
import { type ReadFailure, readFailed } from "./readFailure";

export type CreditMember = Schema["CreditMember"];
export type LibraryCredits = Schema["LibraryCredits"];

type CreditsResult = { ok: true; credits: LibraryCredits } | ReadFailure;

// The ordinal is read at `structure`, and the component spells that one as text.
export async function fetchLibraryCredits(
	origin: string,
	roles: LibraryRoles,
	ask: { structure: number; ordinal: number; splitsCredits: boolean },
	signal?: AbortSignal,
): Promise<CreditsResult> {
	const read = await askResult(
		origin,
		READ_TIMEOUT_MS,
		(api, init) =>
			api.GET("/library/credits", {
				...init,
				cache: "no-store",
				params: {
					query: {
						...roles,
						structure: String(ask.structure),
						ordinal: ask.ordinal,
						splitsCredits: ask.splitsCredits,
					},
				},
			}),
		signal,
	);
	if (!read.ok)
		return readFailed(
			read.reason === "refused" ? "refused" : "unreachable",
			read.message,
		);

	const { value } = read;
	return "artist" in value && "albumArtist" in value
		? { ok: true, credits: value }
		: readFailed("notReady");
}
