import { Search, X } from "lucide-react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import type { Library } from "@/domain/library/useLibrary";
import type { LibrarySearch } from "@/domain/library/useLibrarySearch";
import { Input } from "@/shared/ui/Input";
import styles from "./LibrarySearchField.module.css";

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

		if (event.key === "Enter" || event.key === "ArrowDown") {
			event.preventDefault();
			event.currentTarget.blur();
		}
	};

	return (
		<Input
			size="sm"
			className={styles.field}
			isFilled={hasQuery}
			type="search"
			inputRef={search.inputRef}
			value={query}
			onChange={(event) => onChange(event.target.value)}
			onFocus={search.onFocus}
			onBlur={search.onBlur}
			onKeyDown={onKeyDown}
			placeholder={
				library.needsSetup ? "Set up your library" : "Search your library"
			}
			aria-label="Search your library"
			spellCheck="false"
			autoComplete="off"
			enterKeyHint="search"
			leading={<Search size={15} strokeWidth={2} aria-hidden="true" />}
			trailing={
				hasQuery ? (
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
				)
			}
		/>
	);
}
