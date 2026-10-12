import { Search, X } from "lucide-react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import type { Library } from "@/domain/library/useLibrary";
import type {
	LibrarySearch,
	Suggestion,
} from "@/domain/library/useLibrarySearch";
import { useDismissable } from "@/shared/hooks/useDismissable";
import { useResettingState } from "@/shared/hooks/useResettingState";
import { useFormats, useTranslate } from "@/shared/i18n/useTranslate";
import { hintFor } from "@/shared/keyboard/keymap";
import { useSingleKeyShortcuts } from "@/shared/keyboard/useKeymap";
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
	onLeave: () => void;
}) {
	const t = useTranslate();
	const format = useFormats();
	const [singleKeys] = useSingleKeyShortcuts();
	const searchHint = hintFor("globalSearch", singleKeys);
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
	const [active, setActive] = useResettingState(preselect, [
		suggestions,
		preselect,
	]);

	const isShowing = isOpen && hasDraft;
	const hasOptions = isShowing && suggestions.length > 0;
	const anchor = useDismissable<HTMLDivElement>(
		isShowing,
		() => {
			close();
			revert();
		},
		{ onEscape: false },
	);

	// Both take the caret with them: a panel left under an open software keyboard leaves the keyboard
	// covering whatever the panel was hiding.
	const dismiss = () => {
		close();
		search.inputRef.current?.blur();
	};

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
				onClick={open}
				onBlur={() => {
					search.onBlur();
					onLeave();
				}}
				onKeyDown={onKeyDown}
				placeholder={t("search.yourLibrary")}
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
					) : searchHint === null ? null : (
						<kbd className={styles.hint}>{searchHint}</kbd>
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
