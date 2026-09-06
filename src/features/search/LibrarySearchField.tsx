import { Search, X } from "lucide-react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { useEffect, useState } from "react";
import type { Library } from "@/domain/library/useLibrary";
import type { LibrarySearch } from "@/domain/library/useLibrarySearch";
import { useDismissable } from "@/shared/hooks/useDismissable";
import { Input } from "@/shared/ui/Input";
import styles from "./LibrarySearchField.module.css";
import { optionId, SearchDropdown } from "./SearchDropdown";

const LIST_ID = "search-results-preview";

export function LibrarySearchField({
	search,
	library,
	onChange,
	onSubmit,
	onSelect,
	onDismiss,
}: {
	search: LibrarySearch;
	library: Library;
	onChange: (query: string) => void;
	onSubmit: () => void;
	onSelect: (ref: number) => void;
	onDismiss: () => void;
}) {
	const {
		draft,
		hasDraft,
		isEdited,
		draftCount,
		isFiltering,
		preview,
		draftMatched,
		isOpen,
		open,
		close,
		revert,
	} = search;
	const [active, setActive] = useState(-1);

	// Nothing to preview before there is a library, and "nothing matches that" would blame the query
	// for it. The results page carries the setup flow instead.
	const isShowing = isOpen && hasDraft && !library.needsSetup;
	const hasOptions = isShowing && preview.length > 0;
	// Pointer-down rather than blur: a click on a row blurs the field on its way to the button, and a
	// revert fired from that would empty the draft before the click that meant to commit it arrives.
	const anchor = useDismissable<HTMLDivElement>(
		isShowing,
		() => {
			close();
			revert();
		},
		// Off: the field keeps Escape for itself, since it has several things to undo and the order matters.
		{ onEscape: false },
	);

	// biome-ignore lint/correctness/useExhaustiveDependencies: a new result set drops the cursor, not a read
	useEffect(() => {
		setActive(-1);
	}, [preview]);

	// Both take the caret with them: a panel left under an open software keyboard leaves the keyboard
	// covering whatever the panel was hiding.
	const dismiss = () => {
		close();
		search.inputRef.current?.blur();
	};

	// Every way of committing lands here, including a click on a row, which reaches the panel rather
	// than this field.
	const commit = (ref: number | null) => {
		dismiss();
		if (ref === null) onSubmit();
		else onSelect(ref);
	};

	const move = (by: number) => {
		if (preview.length === 0) return;
		const next = active + by;
		setActive(
			next < -1 ? preview.length - 1 : next >= preview.length ? -1 : next,
		);
	};

	const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
		if (event.key === "Escape") {
			event.preventDefault();
			// Outermost first, one rung per press: panel, then edit, then caret. Never the search itself --
			// ending one is the clear button's job, since the rungs are indistinguishable on screen.
			if (isShowing) close();
			else if (isEdited) revert();
			else event.currentTarget.blur();
			return;
		}

		if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			if (isShowing) {
				event.preventDefault();
				move(event.key === "ArrowDown" ? 1 : -1);
				return;
			}

			// Closed over a query the user has not cleared -- the arrow reopens it, as it would any
			// combobox. With nothing typed there is nothing to reopen, so the key goes to the list behind.
			if (hasDraft) {
				event.preventDefault();
				open();
				return;
			}

			if (event.key === "ArrowDown") {
				event.preventDefault();
				event.currentTarget.blur();
			}
			return;
		}

		if (event.key === "Enter") {
			event.preventDefault();
			// Space is deliberately not a second Enter here: it is a character.
			commit(
				hasOptions && active >= 0 && draftMatched
					? draftMatched[preview[active]]
					: null,
			);
		}
	};

	return (
		<div className={styles.anchor} ref={anchor}>
			<Input
				size="sm"
				className={styles.field}
				isFilled={hasDraft}
				type="search"
				inputRef={search.inputRef}
				value={draft}
				onChange={(event) => onChange(event.target.value)}
				onFocus={search.onFocus}
				// Focus alone is not enough: a field the caret is already in fires nothing, so Escape
				// followed by a click at the field would leave the panel shut with no way back but a key.
				onClick={open}
				onBlur={search.onBlur}
				onKeyDown={onKeyDown}
				placeholder={
					library.needsSetup ? "Set up your library" : "Search your library"
				}
				aria-label="Search your library"
				role="combobox"
				aria-expanded={isShowing}
				aria-controls={hasOptions ? LIST_ID : undefined}
				aria-autocomplete="list"
				aria-activedescendant={
					hasOptions && active >= 0 ? optionId(active) : undefined
				}
				spellCheck="false"
				autoComplete="off"
				enterKeyHint="search"
				leading={<Search size={15} strokeWidth={2} aria-hidden="true" />}
				trailing={
					hasDraft ? (
						<>
							<span className={styles.count} data-pending={isFiltering}>
								{draftCount.toLocaleString()}
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

			{isShowing ? (
				<SearchDropdown
					search={search}
					library={library}
					anchor={anchor}
					listId={LIST_ID}
					active={active}
					onActive={setActive}
					onSelect={commit}
					onDismiss={dismiss}
				/>
			) : null}
		</div>
	);
}
