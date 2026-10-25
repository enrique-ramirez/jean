import {
	type Hold,
	holdsDeclaration,
	isFailureSaid,
} from "@/domain/track/libraryHolds";
import type { FooJeanDiscovery } from "@/shared/api/discovery";
import type { StateDocument } from "@/shared/api/state";
import type { Phrase } from "@/shared/i18n/en";
import type { Translate } from "@/shared/i18n/useTranslate";

type Announced = StateDocument["library"];

export type LibraryFailureReason = "refused" | "failed" | "halted";

export interface LibraryFailure {
	reason: LibraryFailureReason;
	detail: string;
}

export const READ_FAILED = {
	refused: "library.readRefused",
	halted: "library.halted.summary",
	failed: "library.readFailed",
} as const satisfies Record<LibraryFailureReason, Phrase>;

export type LibraryStatus =
	| { kind: "checking" }
	| { kind: "unreachable" }
	| { kind: "olderPlayer" }
	| { kind: "reading"; loaded: number; total: number }
	| { kind: "failed"; failure: LibraryFailure }
	| { kind: "ready" };

function failureOf(announced: Announced | null, hold: Hold) {
	if (announced?.halted) return { reason: "halted", detail: "" } as const;
	if (hold.kind !== "refused" && hold.kind !== "failing") return null;
	if (!isFailureSaid(hold)) return null;
	return {
		reason: hold.kind === "refused" ? "refused" : "failed",
		detail: hold.detail ?? "",
	} as const;
}

export function libraryStatusOf(
	discovery: FooJeanDiscovery | null,
	announced: Announced | null,
	hold: Hold,
): LibraryStatus {
	if (!discovery) return { kind: "checking" };
	if (discovery.state.kind === "unreachable") return { kind: "unreachable" };
	if (!discovery.state.capabilities.canReadLibrary)
		return { kind: "olderPlayer" };
	const failure = failureOf(announced, hold);
	if (failure) return { kind: "failed", failure };
	if (!announced || !holdsDeclaration(announced))
		return {
			kind: "reading",
			loaded: announced?.build?.formatted ?? 0,
			total: announced?.build?.total ?? 0,
		};
	return { kind: "ready" };
}

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
