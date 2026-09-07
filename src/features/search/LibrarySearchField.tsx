import { Search, X } from "lucide-react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { useEffect, useState } from "react";
import type { Library } from "@/domain/library/useLibrary";
import type {
	LibrarySearch,
	Suggestion,
} from "@/domain/library/useLibrarySearch";
import { useDismissable } from "@/shared/hooks/useDismissable";
import { useFormats, useTranslate } from "@/shared/i18n/useTranslate";
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
	onLeave,
}: {
	search: LibrarySearch;
	library: Library;
	onChange: (query: string) => void;
	onSubmit: () => void;
	onSelect: (suggestion: Suggestion) => void;
	onDismiss: () => void;
	// The reader has left the field, by blur or by the last rung of Escape below.
	onLeave?: () => void;
}) {
	const t = useTranslate();
	const format = useFormats();
	const {
		draft,
		hasDraft,
		isEdited,
		draftCount,
		isFiltering,
		suggestions,
		preselect,
		isOpen,
		open,
		close,
		revert,
	} = search;
	const [active, setActive] = useState(-1);

	// Nothing to preview before there is a library, and "nothing matches that" would blame the query
	// for it. The results page carries the setup flow instead.
	const isShowing = isOpen && hasDraft && !library.needsSetup;
	const hasOptions = isShowing && suggestions.length > 0;
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

	// A new result set puts the cursor back where the query says it belongs -- usually nowhere, but on
	// the one row a query with a single reading names.
	// biome-ignore lint/correctness/useExhaustiveDependencies: the results changing is what fires this, not anything read from them
	useEffect(() => {
		setActive(preselect);
	}, [suggestions, preselect]);

	// Both take the caret with them: a panel left under an open software keyboard leaves the keyboard
	// covering whatever the panel was hiding.
	const dismiss = () => {
		close();
		search.inputRef.current?.blur();
	};

	// Every way of committing lands here, including a click on a row, which reaches the panel rather
	// than this field.
	const commit = (suggestion: Suggestion | null) => {
		dismiss();
		if (suggestion === null) onSubmit();
		else onSelect(suggestion);
	};

	const move = (by: number) => {
		const { length } = suggestions;
		if (length === 0) return;
		const next = active + by;
		setActive(next < -1 ? length - 1 : next >= length ? -1 : next);
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
			commit(hasOptions && active >= 0 ? suggestions[active] : null);
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
				onBlur={() => {
					search.onBlur();
					onLeave?.();
				}}
				onKeyDown={onKeyDown}
				placeholder={t(
					library.needsSetup ? "search.setUp" : "search.yourLibrary",
				)}
				aria-label={t("search.yourLibrary")}
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
								{format.number(draftCount)}
							</span>
							<button
								type="button"
								className={styles.clear}
								onClick={onDismiss}
								aria-label={t("search.clear")}
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
