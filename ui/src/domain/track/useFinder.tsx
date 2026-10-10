import { Search } from "lucide-react";
import {
	type RefObject,
	useCallback,
	useDeferredValue,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { hintFor } from "@/shared/keyboard/keymap";
import { useSingleKeyShortcuts } from "@/shared/keyboard/useKeymap";
import { Button } from "@/shared/ui/Button";
import { Finder } from "./Finder";
import type { TrackBrowserHandle } from "./listTypes";
import type { TrackRows } from "./project";
import styles from "./useFinder.module.css";
import { search, useSearchIndex } from "./useSearchIndex";

export function useFinder({
	rows,
	browserRef,
	label,
}: {
	rows: TrackRows;
	browserRef: RefObject<TrackBrowserHandle | null>;
	label: string;
}) {
	const [isFinding, setIsFinding] = useState(false);
	const [singleKeys] = useSingleKeyShortcuts();
	const finderHint = hintFor("openFinder", singleKeys);
	const [query, setQuery] = useState("");

	// The field updates instantly and the scan runs off the deferred copy, or a keystroke carries a
	// scan of the whole list before the character can paint and a phone keyboard starts dropping and
	// reordering input.
	const deferredQuery = useDeferredValue(query);
	const index = useSearchIndex(rows, isFinding);
	const { matches, results } = useMemo(
		() => search(index, rows, deferredQuery),
		[index, rows, deferredQuery],
	);

	const inputRef = useRef<HTMLInputElement | null>(null);

	const focusField = useCallback(() => {
		inputRef.current?.focus();
		inputRef.current?.select();
	}, []);

	// Both openings are `/`, and they are different events: the first has no field to focus yet, so
	// the effect below takes it once the field is mounted, while every one after it is a field that
	// lost the caret to a click on the list.
	const open = useCallback(() => {
		setIsFinding(true);
		focusField();
	}, [focusField]);
	const close = useCallback(() => {
		setIsFinding(false);
		setQuery("");
	}, []);

	useLayoutEffect(() => {
		if (isFinding) focusField();
	}, [isFinding, focusField]);

	const toolbarLeading = isFinding ? (
		<Finder
			inputRef={inputRef}
			rows={rows}
			label={label}
			results={results}
			matches={matches}
			query={query}
			onQueryChange={setQuery}
			onPreview={(index) => browserRef.current?.preview(index)}
			onConfirm={(index) => {
				browserRef.current?.play(index);
				browserRef.current?.scrollToTrack(index, { align: "center" });
				close();
			}}
			onClose={close}
		/>
	) : (
		<Button icon={Search} onClick={open}>
			{label}
			{finderHint === null ? null : (
				<kbd className={styles.hint}>{finderHint}</kbd>
			)}
		</Button>
	);

	return { isFinding, matches, open, close, toolbarLeading };
}
