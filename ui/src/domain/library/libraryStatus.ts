import type { LibraryFailure } from "@/shared/api/fooJeanLibrary";
import type { Phrase } from "@/shared/i18n/en";
import type { Translate } from "@/shared/i18n/useTranslate";

export type LibraryStatus =
	| { kind: "checking" }
	| { kind: "unreachable" }
	| { kind: "olderPlayer" }
	| { kind: "reading"; loaded: number; total: number }
	| { kind: "failed"; failure: LibraryFailure }
	| { kind: "ready" };

export const isLibraryReading = (status: LibraryStatus) =>
	status.kind === "checking" || status.kind === "reading";

export function readingNotice(
	status: LibraryStatus,
	base: Extract<Phrase, "library.reading" | "home.reading">,
	t: Translate,
	counting: "library.readingCount" | "search.reading" = "library.readingCount",
): string {
	if (status.kind !== "reading" || status.loaded <= 0) return t(base);
	const { loaded, total } = status;
	return counting === "search.reading"
		? t(counting, { loaded, total })
		: t(counting, { loaded, total, count: total });
}
