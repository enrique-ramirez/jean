import { Search, X } from "lucide-react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import styles from "./LibrarySearchField.module.css";
import type { Library } from "./useLibrary";
import type { LibrarySearch } from "./useLibrarySearch";

// Persistent and always visible, not a shortcut with an icon bolted on: a
// phone has no keyboard, and an affordance you cannot see is a feature that
// does not exist there. The bindings are the shortcut, not the interface.
export function LibrarySearchField({
	search,
	library,
	onChange,
	onDismiss,
}: {
	search: LibrarySearch;
	library: Library;
	onChange: (query: string) => void;
	onDismiss: () => void;
}) {
	const { query, hasQuery, matchCount, isFiltering } = search;

	const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
		if (event.key === "Escape") {
			event.preventDefault();
			if (hasQuery) onDismiss();
			else event.currentTarget.blur();
			return;
		}

		// Hands the results over to the list: the cursor and every playlist
		// binding are inert while a text field holds focus.
		if (event.key === "Enter" || event.key === "ArrowDown") {
			event.preventDefault();
			event.currentTarget.blur();
		}
	};

	return (
		<div className={styles.field} data-filled={hasQuery}>
			<Search size={15} strokeWidth={2} aria-hidden="true" />

			<input
				ref={search.inputRef}
				className={styles.input}
				type="search"
				value={query}
				onChange={(event) => onChange(event.target.value)}
				onFocus={search.onFocus}
				onBlur={search.onBlur}
				onKeyDown={onKeyDown}
				// Keyed on whether there is a library at all, not on whether a
				// playlist stands in for one. With the media library API there is no
				// playlist and nothing to set up, and asking by playlist told a
				// perfectly working install to go and configure itself.
				placeholder={
					library.needsSetup ? "Set up your library" : "Search your library"
				}
				aria-label="Search your library"
				spellCheck="false"
				autoComplete="off"
				enterKeyHint="search"
			/>

			{hasQuery ? (
				<>
					<span className={styles.count} data-pending={isFiltering}>
						{matchCount.toLocaleString()}
					</span>
					<button
						type="button"
						className={styles.clear}
						onClick={onDismiss}
						aria-label="Clear search"
					>
						<X size={14} strokeWidth={2} />
					</button>
				</>
			) : (
				<kbd className={styles.hint}>⌘K</kbd>
			)}
		</div>
	);
}
