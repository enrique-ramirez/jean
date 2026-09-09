import { Search, X } from "lucide-react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { useTranslate } from "@/shared/i18n/useTranslate";
import { Input } from "@/shared/ui/Input";
import styles from "./GenreFinder.module.css";

export function GenreFinder({
	query,
	onChange,
	completion,
	matchCount,
	onAccept,
	onOpen,
	inputRef,
}: {
	query: string;
	onChange: (query: string) => void;
	completion: string | null;
	matchCount: number;
	onAccept: () => void;
	onOpen: () => void;
	inputRef: React.RefObject<HTMLInputElement | null>;
}) {
	const t = useTranslate();
	const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
		if (event.key === "Escape") {
			event.preventDefault();
			if (query) onChange("");
			else event.currentTarget.blur();
			return;
		}

		if (event.key === "Enter") {
			event.preventDefault();
			onOpen();
			return;
		}

		const caretAtEnd =
			event.currentTarget.selectionStart === query.length &&
			event.currentTarget.selectionEnd === query.length;

		if (
			completion &&
			caretAtEnd &&
			(event.key === "ArrowRight" || (event.key === "Tab" && !event.shiftKey))
		) {
			event.preventDefault();
			onAccept();
		}
	};

	return (
		<Input
			size="lg"
			className={styles.field}
			value={query}
			onChange={(event) => onChange(event.target.value)}
			onKeyDown={onKeyDown}
			placeholder={t("shortcut.findGenre")}
			aria-label={t("shortcut.findGenre")}
			spellCheck="false"
			autoComplete="off"
			autoCorrect="off"
			autoCapitalize="off"
			enterKeyHint="go"
			inputRef={inputRef}
			leading={<Search size={17} strokeWidth={2} aria-hidden="true" />}
			underlay={
				<span className={styles.ghost} aria-hidden="true">
					<span className={styles.typed}>{query}</span>
					{completion}
				</span>
			}
			trailing={
				query ? (
					<>
						<span className={styles.matches}>{matchCount || "none"}</span>
						<button
							type="button"
							className={styles.clear}
							aria-label={t("action.clear")}
							onClick={() => {
								onChange("");
								inputRef.current?.focus();
							}}
						>
							<X size={15} strokeWidth={2.2} aria-hidden="true" />
						</button>
					</>
				) : (
					<kbd className={styles.hint}>/</kbd>
				)
			}
		/>
	);
}
