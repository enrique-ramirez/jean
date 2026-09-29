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

export function libraryNoticeFor(
	library: Pick<Library, "status" | "origin" | "recheck">,
): ReactNode | null {
	const { status } = library;
	if (
		status.kind !== "unreachable" &&
		status.kind !== "olderPlayer" &&
		status.kind !== "failed"
	)
		return null;
	return (
		<LibraryNotice
			status={status}
			origin={library.origin}
			recheck={library.recheck}
		/>
	);
}

export function LibraryNotice({
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
			<div className={styles.notice}>
				<p className={styles.summary}>{t("library.olderPlayer.summary")}</p>
				<p className={styles.fix}>{t("library.olderPlayer.fix")}</p>
			</div>
		);

	if (status.kind === "unreachable")
		return (
			<div className={styles.notice}>
				<p className={styles.summary}>{t("fooJean.unreachable.summary")}</p>
				<p className={styles.fix}>{t("fooJean.unreachable.fix")}</p>
				<Button onClick={recheck}>{t("fooJean.checkAgain")}</Button>
			</div>
		);

	const { failure } = status;
	const message = t(READ_FAILED[failure.reason]);

	return (
		<div className={styles.notice}>
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
