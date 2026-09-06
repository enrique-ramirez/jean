import { Search, X } from "lucide-react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";

import { Input } from "@/shared/ui/Input";
import styles from "./GenreFinder.module.css";

// The centre of the page rather than a control in a corner: an index of a hundred and forty is
// reached by typing, and everything else here is for the visit where you do not know what you want.
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

		// The one place Jean takes Tab, and only while there is something to accept, so an empty field
		// still tabs onward.
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
			placeholder="Find a genre"
			aria-label="Find a genre"
			spellCheck="false"
			autoComplete="off"
			autoCorrect="off"
			autoCapitalize="off"
			enterKeyHint="go"
			inputRef={inputRef}
			leading={<Search size={17} strokeWidth={2} aria-hidden="true" />}
			underlay={
				// Hidden from readers: the input's own value is what a reader should hear.
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
							aria-label="Clear"
							onClick={() => {
								onChange("");
								inputRef.current?.focus();
							}}
						>
							<X size={15} strokeWidth={2.2} aria-hidden="true" />
						</button>
					</>
				) : (
					// The binding, shown where the field is: the page is reached without a keyboard too.
					<kbd className={styles.hint}>/</kbd>
				)
			}
		/>
	);
}
