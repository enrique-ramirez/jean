import { Check, ChevronLeft, Settings } from "lucide-react";
import {
	type KeyboardEvent as ReactKeyboardEvent,
	useEffect,
	useId,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import type { OutputDevice } from "@/shared/api/outputs";
import { useTranslate } from "@/shared/i18n/useTranslate";
import { rovedIndex } from "@/shared/lib/rove";
import { MenuItem } from "@/shared/ui/Menu";
import styles from "./OutputDevices.module.css";

// What either host of the picker needs: the list, which one is active, a way to choose one and a
// way to say the picker just opened, so `useOutputs`'s `refetch` runs when a picker opens rather
// than on every render.
export interface OutputPicker {
	devices: OutputDevice[];
	activeId: string | null;
	onChoose: (deviceId: string) => void;
	onOpen: () => void;
}

// The cog `VolumePopover` and the Playing on panel both carry: one component both render, so
// they stay alike by construction rather than by two callers agreeing.
export function OutputCog({
	onClick,
	autoFocus = false,
}: {
	onClick: () => void;
	autoFocus?: boolean;
}) {
	const t = useTranslate();
	const label = t("player.outputOptions");
	const ref = useRef<HTMLButtonElement | null>(null);

	useLayoutEffect(() => {
		if (autoFocus) ref.current?.focus({ preventScroll: true });
	}, [autoFocus]);

	return (
		<button
			ref={ref}
			type="button"
			className={styles.cog}
			aria-label={label}
			title={label}
			onClick={onClick}
		>
			<Settings size={14} strokeWidth={2} aria-hidden="true" />
		</button>
	);
}

// The paging both the popover and the panel do: their own content in place, or this list, never
// both. `isHostOpen` is the popover's or the panel's own open flag, not this page's: closing the
// host always drops the page back to its own content, so the next open starts there again, rather
// than carrying "was showing the list" across a dismissal.
export function useOutputPage(isHostOpen: boolean) {
	const [showsOutputs, setShowsOutputs] = useState(false);
	const [returnFocus, setReturnFocus] = useState(false);

	useEffect(() => {
		if (!isHostOpen) {
			setShowsOutputs(false);
			setReturnFocus(false);
		}
	}, [isHostOpen]);

	return {
		showsOutputs,
		returnFocus,
		open: (onOpen: () => void) => {
			setShowsOutputs(true);
			setReturnFocus(false);
			onOpen();
		},
		close: () => {
			setShowsOutputs(false);
			setReturnFocus(true);
		},
	};
}

// macOS's Sound menu is the model for every presentation here: a bare check on the active row and
// nothing on the rest, never `ColumnsMenu`'s boxes, since two outputs cannot both be playing the
// way two columns can both be shown.
function Tick({ checked }: { checked: boolean }) {
	return (
		<span className={styles.tick} aria-hidden="true">
			{checked ? <Check size={14} strokeWidth={2.5} /> : null}
		</span>
	);
}

export function OutputMenuRows({
	devices,
	activeId,
	onChoose,
}: {
	devices: OutputDevice[];
	activeId: string | null;
	onChoose: (deviceId: string) => void;
}) {
	return (
		<>
			{devices.map((device) => (
				<MenuItem
					key={device.id}
					role="menuitemradio"
					aria-checked={device.id === activeId}
					onClick={() => onChoose(device.id)}
				>
					<Tick checked={device.id === activeId} />
					<span className={styles.name}>{device.name}</span>
				</MenuItem>
			))}
		</>
	);
}

// The in-place page `VolumePopover` and the Playing on panel turn to: a heading, the same rows as
// a `radiogroup` of `radio`s, and a back control, none of it a `Menu`, since both hosts turn a
// surface they already own rather than opening a new one.
export function OutputDeviceList({
	devices,
	activeId,
	onChoose,
	onBack,
	subtitle,
}: {
	devices: OutputDevice[];
	activeId: string | null;
	onChoose: (deviceId: string) => void;
	onBack: () => void;
	// The player's own name, read alongside the heading on the Playing on panel's page only: that
	// panel is about the player's output and this device's listening both, so the header says which
	// one this list is. The subtitle sits outside the heading element the `radiogroup` names itself
	// after, so the list's own accessible name stays plain "Output device".
	subtitle?: string;
}) {
	const t = useTranslate();
	const headingId = useId();
	const rowRefs = useRef<(HTMLButtonElement | null)[]>([]);

	const initialFocus = useRef(
		Math.max(
			devices.findIndex((device) => device.id === activeId),
			0,
		),
	).current;

	const [tabStop, setTabStop] = useState(initialFocus);

	useLayoutEffect(() => {
		rowRefs.current[initialFocus]?.focus({ preventScroll: true });
	}, [initialFocus]);

	// Arrows move which row has focus and nothing else: choosing a device is Enter, Space or a
	// click, so a key pressed while only looking through the list can never send a switch nobody
	// asked for.
	const onRowKeyDown = (
		event: ReactKeyboardEvent<HTMLButtonElement>,
		index: number,
	) => {
		const next = rovedIndex(event.key, index, devices.length, { wrap: true });
		if (next === null) return;
		event.preventDefault();
		setTabStop(next);
		rowRefs.current[next]?.focus();
	};

	return (
		<div className={styles.page}>
			<div className={styles.header}>
				<button
					type="button"
					className={styles.back}
					aria-label={t("player.outputBack")}
					onClick={onBack}
				>
					<ChevronLeft size={16} strokeWidth={2} aria-hidden="true" />
				</button>
				<h2 id={headingId} className={styles.heading}>
					{t("player.outputDeviceList")}
				</h2>
				{subtitle ? <span className={styles.subtitle}>{subtitle}</span> : null}
			</div>
			<div
				role="radiogroup"
				aria-labelledby={headingId}
				className={styles.list}
			>
				{devices.map((device, index) => (
					// biome-ignore lint/a11y/useSemanticElements: a radio input answers to a form; this sends a command at once, the way `MenuItem`'s own button already does
					<button
						key={device.id}
						ref={(row) => {
							rowRefs.current[index] = row;
						}}
						type="button"
						role="radio"
						aria-checked={device.id === activeId}
						tabIndex={index === tabStop ? 0 : -1}
						className={styles.row}
						onClick={() => onChoose(device.id)}
						onKeyDown={(event) => onRowKeyDown(event, index)}
					>
						<Tick checked={device.id === activeId} />
						<span className={styles.name}>{device.name}</span>
					</button>
				))}
			</div>
		</div>
	);
}
