import { useTranslate } from "@/shared/i18n/useTranslate";
import { Button } from "@/shared/ui/Button";
import styles from "./LibraryNotice.module.css";
import type { QuestionFailed } from "./questionFailed";

const LINE = {
	failed: "library.readFailed",
	unreachable: "library.readUnreachable",
} as const;

export function QuestionFailure({
	reason,
	retry,
	className,
	focusTo,
}: QuestionFailed & {
	className?: string;
	focusTo?: () => HTMLElement | null;
}) {
	const t = useTranslate();

	return (
		<div
			className={className ? `${styles.notice} ${className}` : styles.notice}
			role="status"
		>
			<p className={styles.summary}>{t(LINE[reason])}</p>
			<Button
				onClick={(event) => {
					// The button goes with the failure, and focus left on it would fall to the body.
					const target = focusTo
						? focusTo()
						: event.currentTarget.closest("main");
					target?.focus();
					retry();
				}}
			>
				{t("action.tryAgain")}
			</Button>
		</div>
	);
}
