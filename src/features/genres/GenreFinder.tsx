import { Search, X } from "lucide-react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";

import { fold } from "@/shared/lib/text";
import { Input } from "@/shared/ui/Input";
import styles from "./GenreFinder.module.css";

/**
 * The completion drawn behind the caret, or null where there is none to draw.
 *
 * Only offered where the best match *starts with what was typed, character for character* -- the
 * ghost sits under the real text and any other kind of match would print two different strings on
 * top of each other. So `heavy` completes to `Heavy Metal`, and `heavymetal` completes to nothing
 * even though it still finds the genre: the matcher is looser than a completion can be honest about.
 */
export function completionFor(
	query: string,
	best: string | null,
): string | null {
	if (!query || !best) return null;
	if (!fold(best).startsWith(fold(query))) return null;
	const rest = best.slice(query.length);
	return rest.length > 0 ? rest : null;
}

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
	/** Take the completion into the field. */
	onAccept: () => void;
	/** Open the best match outright. */
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

		// Tab completes rather than leaving the field, which is the one place Jean takes Tab: a
		// completion nobody can accept without reaching for the mouse is decoration. Only while there
		// is something to accept, so an empty field still tabs onward.
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
