import type { ReactNode } from "react";
import { READ_FAILED, tryLibraryAgain } from "@/domain/track/libraryLoader";
import { TRANSIENT } from "@/shared/api/fooJeanLibrary";
import { useTranslate } from "@/shared/i18n/useTranslate";
import { Button } from "@/shared/ui/Button";
import styles from "./LibraryNotice.module.css";
import type { LibraryStatus } from "./libraryStatus";
import type { Library } from "./useLibrary";

type NoticeStatus = Extract<
	LibraryStatus,
	{ kind: "unreachable" | "olderPlayer" | "failed" }
>;

const isDrawable = (library: Pick<Library, "columns">) =>
	library.columns.trackCount > 0;

const isNoticeStatus = (status: LibraryStatus): status is NoticeStatus =>
	status.kind === "unreachable" ||
	status.kind === "olderPlayer" ||
	status.kind === "failed";

export function libraryNoticeFor(
	library: Pick<Library, "status" | "origin" | "recheck" | "columns">,
): ReactNode | null {
	const { status } = library;
	if (!isNoticeStatus(status)) return null;
	if (status.kind === "failed" && isDrawable(library)) return null;
	return (
		<LibraryNotice
			status={status}
			origin={library.origin}
			recheck={library.recheck}
		/>
	);
}

export function libraryFailureBesideRows(
	library: Pick<Library, "status" | "origin" | "recheck" | "columns">,
): ReactNode | null {
	const { status } = library;
	if (status.kind !== "failed" || !isDrawable(library)) return null;
	return (
		<LibraryNotice
			status={status}
			origin={library.origin}
			recheck={library.recheck}
		/>
	);
}

function LibraryNotice({
	status,
	origin,
	recheck,
}: {
	status: NoticeStatus;
	origin: string | null;
	recheck: () => void;
}) {
	const t = useTranslate();

	if (status.kind === "olderPlayer")
		return (
			<div className={styles.notice} role="status">
				<p className={styles.summary}>{t("library.olderPlayer.summary")}</p>
				<p className={styles.fix}>{t("library.olderPlayer.fix")}</p>
			</div>
		);

	if (status.kind === "unreachable")
		return (
			<div className={styles.notice} role="status">
				<p className={styles.summary}>{t("fooJean.unreachable.summary")}</p>
				<p className={styles.fix}>{t("fooJean.unreachable.fix")}</p>
				<Button onClick={recheck}>{t("fooJean.checkAgain")}</Button>
			</div>
		);

	const { failure } = status;
	const message = t(READ_FAILED[failure.reason]);

	if (failure.reason === "halted")
		return (
			<div className={styles.notice} role="status">
				<p className={styles.summary}>{message}</p>
				<p className={styles.fix}>{t("library.halted.fix")}</p>
			</div>
		);

	return (
		<div className={styles.notice} role="status">
			<p className={styles.summary}>
				{failure.detail
					? t("library.readDetail", { message, detail: failure.detail })
					: message}
			</p>
			{TRANSIENT.has(failure.reason) && origin ? (
				<Button onClick={() => tryLibraryAgain(origin)}>
					{t("action.tryAgain")}
				</Button>
			) : null}
		</div>
	);
}
