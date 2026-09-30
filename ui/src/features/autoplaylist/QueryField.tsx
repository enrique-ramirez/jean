import {
	type ChangeEvent,
	type KeyboardEvent,
	type SyntheticEvent,
	useId,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";

import {
	completionsAt,
	quoted,
	type Suggestion,
	type ValueSource,
} from "@/domain/library/queryCompletion";
import type { Phrase } from "@/shared/i18n/en";
import { useTranslate } from "@/shared/i18n/useTranslate";
import { Input } from "@/shared/ui/Input";
import styles from "./QueryField.module.css";
import { piecesOf } from "./queryHighlight";

const MAX_OPTIONS = 8;

const KIND_PHRASE = {
	field: "autoplaylist.kind.field",
	operator: "autoplaylist.kind.operator",
	value: "autoplaylist.kind.value",
	junction: "autoplaylist.kind.junction",
} as const satisfies Record<Suggestion["kind"], Phrase>;

export function QueryField({
	id,
	value,
	values,
	onChange,
}: {
	id: string;
	value: string;
	values: ValueSource;
	onChange: (query: string) => void;
}) {
	const t = useTranslate();
	const listId = useId();
	const optionId = (index: number) => `${listId}-${index}`;

	const inputRef = useRef<HTMLInputElement | null>(null);
	const anchorRef = useRef<HTMLDivElement | null>(null);
	const ghostRef = useRef<HTMLSpanElement | null>(null);
	const trackRef = useRef<HTMLSpanElement | null>(null);
	const headRef = useRef<HTMLSpanElement | null>(null);
	const caretAfterInsert = useRef<number | null>(null);

	const [caret, setCaret] = useState(0);
	const [isFocused, setFocused] = useState(false);
	const [isOpen, setOpen] = useState(false);
	const [active, setActive] = useState(-1);

	const completion = useMemo(
		() => completionsAt(value, Math.min(caret, value.length), values),
		[value, caret, values],
	);
	const typed = value.slice(completion.from, completion.to);
	const suggestions = useMemo(
		() =>
			completion.suggestions
				.filter(
					(suggestion) =>
						suggestion.insert !== typed && quoted(suggestion.label) !== typed,
				)
				.slice(0, MAX_OPTIONS),
		[completion, typed],
	);
	const isShowing = isFocused && isOpen && suggestions.length > 0;

	const pieces = useMemo(() => piecesOf(value), [value]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: `value` fires this rather than being read in it.
	useLayoutEffect(() => {
		const at = caretAfterInsert.current;
		if (at === null) return;
		caretAfterInsert.current = null;
		inputRef.current?.setSelectionRange(at, at);
	}, [value]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: `value` and `caret` fire this rather than being read in it.
	useLayoutEffect(() => {
		const input = inputRef.current;
		const track = trackRef.current;
		if (!input || !track) return;
		track.style.transform = `translateX(${-input.scrollLeft}px)`;

		const anchor = anchorRef.current;
		const ghost = ghostRef.current;
		const head = headRef.current;
		if (!isShowing || !anchor || !ghost || !head) return;
		const x =
			head.getBoundingClientRect().width +
			ghost.getBoundingClientRect().left -
			anchor.getBoundingClientRect().left -
			input.scrollLeft;
		anchor.style.setProperty("--caret-x", `${x}px`);
	}, [value, caret, isShowing]);

	const readCaret = (input: HTMLInputElement) =>
		input.selectionStart ?? input.value.length;

	const insert = (suggestion: Suggestion) => {
		const { from, to } = completion;
		const tail = value.slice(to);
		const gap = /^\s/.test(tail) ? "" : " ";
		const at = from + suggestion.insert.length + 1;

		caretAfterInsert.current = at;
		onChange(value.slice(0, from) + suggestion.insert + gap + tail);
		setCaret(at);
		setActive(-1);
		setOpen(true);
		inputRef.current?.focus();
	};

	const move = (by: number) => {
		const next = active + by;
		setActive(
			next < -1
				? suggestions.length - 1
				: next >= suggestions.length
					? -1
					: next,
		);
	};

	const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if (event.nativeEvent.isComposing) return;

		if (event.key === "Escape" && isShowing) {
			event.preventDefault();
			event.stopPropagation();
			setOpen(false);
			return;
		}

		if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			if (suggestions.length === 0) return;
			event.preventDefault();
			if (isShowing) move(event.key === "ArrowDown" ? 1 : -1);
			else setOpen(true);
			return;
		}

		if (event.key === "Tab" && !event.shiftKey && isShowing) {
			event.preventDefault();
			insert(suggestions[Math.max(active, 0)]);
			return;
		}

		if (event.key === "Enter") {
			event.preventDefault();
			if (isShowing && active >= 0) insert(suggestions[active]);
		}
	};

	const onInput = (event: ChangeEvent<HTMLInputElement>) => {
		onChange(event.target.value);
		setCaret(readCaret(event.target));
		setActive(-1);
		setOpen(true);
	};

	const onSelect = (event: SyntheticEvent<HTMLInputElement>) => {
		const at = readCaret(event.currentTarget);
		if (at === caret) return;
		setCaret(at);
		setActive(-1);
	};

	return (
		<div className={styles.anchor} ref={anchorRef}>
			<Input
				size="md"
				className={styles.field}
				id={id}
				inputRef={inputRef}
				value={value}
				onChange={onInput}
				onSelect={onSelect}
				onScroll={() => {
					const input = inputRef.current;
					if (input && trackRef.current)
						trackRef.current.style.transform = `translateX(${-input.scrollLeft}px)`;
				}}
				onKeyDown={onKeyDown}
				onFocus={() => setFocused(true)}
				onBlur={() => setFocused(false)}
				role="combobox"
				aria-expanded={isShowing}
				aria-controls={isShowing ? listId : undefined}
				aria-autocomplete="list"
				aria-activedescendant={
					isShowing && active >= 0 ? optionId(active) : undefined
				}
				spellCheck="false"
				autoComplete="off"
				autoCorrect="off"
				autoCapitalize="off"
				enterKeyHint="done"
				autoFocus
				underlay={
					<span className={styles.ghost} ref={ghostRef} aria-hidden="true">
						<span className={styles.track} ref={trackRef}>
							{pieces.map((piece, at) => (
								// biome-ignore lint/suspicious/noArrayIndexKey: pieces are rebuilt whole from the text and have no identity of their own
								<span key={at} data-keyword={piece.isKeyword || undefined}>
									{piece.text}
								</span>
							))}
						</span>
						<span className={styles.head} ref={headRef}>
							{value.slice(0, caret)}
						</span>
					</span>
				}
			/>

			{isShowing ? (
				// biome-ignore lint/a11y/noStaticElementInteractions: keeps the caret in the field while an option is pressed
				<div
					className={styles.popup}
					onMouseDown={(event) => event.preventDefault()}
				>
					<div className={styles.list} id={listId} role="listbox">
						{suggestions.map((suggestion, index) => (
							<button
								key={`${suggestion.kind}:${suggestion.insert}`}
								type="button"
								id={optionId(index)}
								role="option"
								tabIndex={-1}
								aria-selected={index === active}
								className={styles.option}
								data-active={index === active || undefined}
								onClick={() => insert(suggestion)}
							>
								<span className={styles.label}>{suggestion.label}</span>
								<span className={styles.kind}>
									{t(KIND_PHRASE[suggestion.kind])}
								</span>
							</button>
						))}
					</div>
					<p className={styles.hint}>{t("autoplaylist.hint")}</p>
				</div>
			) : null}
		</div>
	);
}
