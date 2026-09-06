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
import type { TrackColumns } from "@/shared/api/types";
import { Button } from "@/shared/ui/Button";
import { Finder } from "./Finder";
import type { TrackBrowserHandle } from "./listTypes";
import styles from "./useFinder.module.css";
import { search, useSearchIndex } from "./useSearchIndex";

// Find-in-this-list, for any view that renders a `TrackBrowser`. Not the top-bar search, which filters the library down to matches and navigates to `#/search`.
export function useFinder({
	rows,
	browserRef,
	label,
}: {
	rows: TrackColumns[];
	browserRef: RefObject<TrackBrowserHandle | null>;
	label: string;
}) {
	const [isFinding, setIsFinding] = useState(false);
	const [query, setQuery] = useState("");

	// The field updates instantly; the scan runs off the deferred copy, or a keystroke carries a scan of the whole list before the character can paint and a phone keyboard starts dropping and reordering input.
	const deferredQuery = useDeferredValue(query);
	const haystacks = useSearchIndex(rows, isFinding);
	const { matches, results } = useMemo(
		() => search(haystacks, deferredQuery),
		[haystacks, deferredQuery],
	);

	const inputRef = useRef<HTMLInputElement | null>(null);

	const focusField = useCallback(() => {
		inputRef.current?.focus();
		inputRef.current?.select();
	}, []);

	// The two openings are different events and both are `/`: the first has no field to focus yet, so the effect below takes it once the field is mounted; every one after it is a field that lost the caret to a click on the list, which is this call and nothing else.
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
			<kbd className={styles.hint}>/</kbd>
		</Button>
	);

	// `isFinding` is returned because the list has to stop answering to the keyboard while a field has it, or typing a track name seeks the player.
	return { isFinding, matches, open, close, toolbarLeading };
}
