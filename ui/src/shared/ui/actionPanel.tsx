import { Check, ChevronLeft, ChevronRight, Search } from "lucide-react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { translate } from "@/shared/i18n/locale";
import { fold, matchesTokens, tokenize } from "@/shared/lib/text";
import type { ActionEntry, ActionNode, MenuHeader } from "./ActionMenu";
import styles from "./ActionMenu.module.css";
import { Input } from "./Input";
import { handleMenuKeys } from "./menuKeys";

export interface Page {
	id: string;
	label?: string;
	items: ActionNode[];
	filter?: string;
}

const pagesAlong = (
	items: ActionNode[] | undefined,
	[id, ...rest]: string[],
): Page[] => {
	const node = id === undefined ? null : items?.find((item) => item.id === id);
	return node && "items" in node && node.items
		? [node as Page, ...pagesAlong(node.items, rest)]
		: [];
};

function usePages(actions: ActionNode[]) {
	const [trail, setTrail] = useState<string[]>([]);

	const pages = useMemo(
		() => [{ id: "root", items: actions }, ...pagesAlong(actions, trail)],
		[actions, trail],
	);

	const push = useCallback(
		(id: string) => setTrail((current) => [...current, id]),
		[],
	);
	const pop = useCallback(
		() => setTrail((current) => current.slice(0, -1)),
		[],
	);

	return { pages, depth: pages.length - 1, push, pop };
}

// `focusFilter` is on for the popover and off for the sheet: autofocus summons the software
// keyboard, which costs half the screen on touch.
export function usePanel({
	actions,
	onDismiss,
	canFilter = false,
	focusFilter = false,
}: {
	actions: ActionNode[];
	onDismiss: () => void;
	canFilter?: boolean;
	focusFilter?: boolean;
}) {
	const { pages, depth, push, pop } = usePages(actions);
	const pageRefs = useRef<(HTMLDivElement | null)[]>([]);
	const [height, setHeight] = useState<number | null>(null);
	const [query, setQuery] = useState("");

	// biome-ignore lint/correctness/useExhaustiveDependencies: a new page is a new node to observe, and a nested page's content can settle after it mounts
	useLayoutEffect(() => {
		const element = pageRefs.current[depth];
		if (!element) return undefined;

		const measure = () => setHeight(element.offsetHeight);
		measure();

		const observer = new ResizeObserver(measure);
		observer.observe(element);
		return () => observer.disconnect();
	}, [depth, pages]);

	const back = useCallback(() => {
		setQuery("");
		return depth > 0 ? pop() : onDismiss();
	}, [depth, pop, onDismiss]);

	const select = useCallback(
		(node: ActionEntry) => {
			if (node.items) {
				setQuery("");
				push(node.id);
				return;
			}
			node.onSelect?.();
			if (!node.keepOpen) onDismiss();
		},
		[push, onDismiss],
	);

	const active = pages[depth];
	const isFiltered = canFilter && Boolean(active?.filter);

	useEffect(() => {
		if (!isFiltered || !focusFilter) return;
		pageRefs.current[depth]
			?.querySelector("input")
			?.focus({ preventScroll: true });
	}, [isFiltered, focusFilter, depth]);

	const pageKeys = ({
		event,
		items,
		at,
	}: {
		event: ReactKeyboardEvent;
		items: HTMLElement[];
		at: number;
	}) => {
		if (event.target instanceof HTMLInputElement) {
			if (event.key !== "Enter") return false;
			items[0]?.click();
			return true;
		}

		if (event.key === "ArrowLeft") {
			back();
			return true;
		}

		if (event.key === "ArrowRight" && items[at]?.dataset.submenu) {
			items[at].click();
			return true;
		}

		return false;
	};

	const onKeyDown = (event: ReactKeyboardEvent) =>
		handleMenuKeys(event, {
			container: pageRefs.current[depth],
			onEscape: back,
			beyond: pageKeys,
		});

	const visibleItems = (page: Page, isActive: boolean): ActionNode[] => {
		const tokens = tokenize(query);
		if (!isActive || !isFiltered || tokens.length === 0) return page.items;

		const matched = page.items.filter(
			(node) => !node.type && matchesTokens(fold(node.label), tokens),
		);
		return matched.length > 0
			? matched
			: [{ type: "message", text: translate("menu.noMatch") }];
	};

	const body = (
		<div
			className={styles.viewport}
			style={height === null ? undefined : { height }}
		>
			<div
				className={styles.track}
				style={{ transform: `translateX(${depth * -100}%)` }}
			>
				{pages.map((page, index) => (
					<div
						key={page.id}
						className={styles.page}
						ref={(element) => {
							pageRefs.current[index] = element;
						}}
						role="menu"
						aria-label={page.label}
						inert={index === depth ? undefined : true}
					>
						{index === depth && isFiltered ? (
							<Input
								size="sm"
								className={styles.filter}
								value={query}
								placeholder={page.filter}
								aria-label={page.filter}
								spellCheck="false"
								autoComplete="off"
								onChange={(event) => setQuery(event.target.value)}
								leading={
									<Search size={14} strokeWidth={2} aria-hidden="true" />
								}
							/>
						) : null}

						{visibleItems(page, index === depth).map((node, position) => (
							<Node
								key={node.id ?? `${node.type}-${position}`}
								node={node}
								onSelect={select}
							/>
						))}
					</div>
				))}
			</div>
		</div>
	);

	return { body, onKeyDown, page: active, depth, back };
}

function Node({
	node,
	onSelect,
}: {
	node: ActionNode;
	onSelect: (node: ActionEntry) => void;
}) {
	if (node.type === "separator") return <hr className={styles.separator} />;
	if (node.type === "message")
		return <p className={styles.message}>{node.text}</p>;

	const Icon = node.icon;
	const hasSubmenu = Boolean(node.items);
	const role =
		node.checked === undefined
			? { role: "menuitem" }
			: { role: "menuitemradio", "aria-checked": node.checked };

	return (
		<button
			type="button"
			{...role}
			className={styles.item}
			data-danger={node.danger ? "true" : undefined}
			data-icon-tone={node.iconTone}
			data-submenu={hasSubmenu ? "true" : undefined}
			disabled={node.disabled}
			aria-haspopup={hasSubmenu ? "menu" : undefined}
			onClick={() => onSelect(node)}
		>
			<span className={styles.rail} aria-hidden="true" />
			{Icon ? (
				<Icon
					className={styles.icon}
					size={18}
					strokeWidth={1.9}
					aria-hidden="true"
				/>
			) : null}
			<span className={styles.label}>{node.label}</span>
			{node.shortcut ? (
				<kbd className={styles.shortcut}>{node.shortcut}</kbd>
			) : null}
			{node.checked ? (
				<Check
					className={styles.tick}
					size={15}
					strokeWidth={2.4}
					aria-hidden="true"
				/>
			) : null}
			{hasSubmenu ? (
				<ChevronRight
					className={styles.chevron}
					size={15}
					strokeWidth={2}
					aria-hidden="true"
				/>
			) : null}
		</button>
	);
}

export function Header({
	header,
	page,
	depth,
	onBack,
}: {
	header?: MenuHeader | null;
	page: Page;
	depth: number;
	onBack: () => void;
}) {
	if (depth > 0) {
		return (
			<button type="button" className={styles.back} onClick={onBack}>
				<ChevronLeft size={15} strokeWidth={2.2} aria-hidden="true" />
				<span className={styles.backLabel}>{page.label}</span>
			</button>
		);
	}

	if (!header) return null;

	const Icon = header.icon;

	return (
		<div className={styles.header}>
			{Icon ? (
				<span className={styles.headerIcon} aria-hidden="true">
					<Icon size={17} strokeWidth={1.9} />
				</span>
			) : null}
			<span className={styles.headerText}>
				<span className={styles.headerTitle}>{header.title}</span>
				{header.subtitle ? (
					<span className={styles.headerMeta}>{header.subtitle}</span>
				) : null}
			</span>
		</div>
	);
}

export interface PanelProps {
	header?: MenuHeader | null;
	actions: ActionNode[];
	onDismiss: () => void;
}
