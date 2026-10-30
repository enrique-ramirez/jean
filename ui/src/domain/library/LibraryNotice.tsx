import type { ReactNode } from "react";
import { useTranslate } from "@/shared/i18n/useTranslate";
import { Button } from "@/shared/ui/Button";
import styles from "./LibraryNotice.module.css";
import { type LibraryStatus, READ_FAILED } from "./libraryStatus";
import type { Library } from "./useLibrary";

type NoticeStatus = Extract<
	LibraryStatus,
	{ kind: "unreachable" | "olderPlayer" | "failed" }
>;

const isDrawable = (library: Pick<Library, "trackCount">) =>
	library.trackCount > 0;

const isNoticeStatus = (status: LibraryStatus): status is NoticeStatus =>
	status.kind === "unreachable" ||
	status.kind === "olderPlayer" ||
	status.kind === "failed";

type NoticeSource = Pick<
	Library,
	"status" | "recheck" | "retry" | "trackCount"
>;

const noticeOf = ({ status, recheck, retry }: NoticeSource) =>
	isNoticeStatus(status) ? (
		<LibraryNotice status={status} recheck={recheck} retry={retry} />
	) : null;

export function libraryNoticeFor(library: NoticeSource): ReactNode | null {
	const { status } = library;
	if (status.kind === "failed" && isDrawable(library)) return null;
	return noticeOf(library);
}

export function libraryFailureBesideRows(
	library: NoticeSource,
): ReactNode | null {
	return library.status.kind === "failed" && isDrawable(library)
		? noticeOf(library)
		: null;
}

function LibraryNotice({
	status,
	recheck,
	retry,
}: {
	status: NoticeStatus;
	recheck: () => void;
	retry: () => void;
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
			{failure.reason === "failed" ? (
				<Button onClick={retry}>{t("action.tryAgain")}</Button>
			) : null}
		</div>
	);
}
