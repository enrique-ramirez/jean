import { askResult, READ_TIMEOUT_MS, type Schema } from "./client";
import type { LibraryRoles } from "./libraryQuestions";
import { type ReadFailure, readFailed } from "./readFailure";

export type CreditMember = Schema["CreditMember"];
export type LibraryCredits = Schema["LibraryCredits"];

type CreditsResult = { ok: true; credits: LibraryCredits } | ReadFailure;

export type CreditsAddress =
	| { structure: number; ordinal: number }
	| { track: string; subsong: number };

// The ordinal is read at `structure`, and the component spells that one as text. The component
// refuses a request naming both forms, so only the one given is sent.
export async function fetchLibraryCredits(
	origin: string,
	roles: LibraryRoles,
	ask: CreditsAddress & { splitsCredits: boolean },
	signal?: AbortSignal,
): Promise<CreditsResult> {
	const address =
		"track" in ask
			? { track: ask.track, subsong: ask.subsong }
			: { structure: String(ask.structure), ordinal: ask.ordinal };
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
						...address,
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
