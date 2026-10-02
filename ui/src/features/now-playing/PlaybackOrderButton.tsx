import {
	CircleQuestionMark,
	Dices,
	DiscAlbum,
	Folders,
	LayoutArrowDown,
	ListRestart,
	Repeat1,
	Shuffle,
} from "lucide-react";
import {
	type KeyboardEvent as ReactKeyboardEvent,
	useRef,
	useState,
} from "react";
import type { usePlaybackOrder } from "@/domain/player/usePlaybackOrder";
import type { PlaybackMode } from "@/shared/api/types";
import type { Point } from "@/shared/hooks/useLongPress";
import { useTranslate } from "@/shared/i18n/useTranslate";
import { SCOPE } from "@/shared/keyboard/keymap";
import { useKeymap } from "@/shared/keyboard/useKeymap";
import { ActionMenu } from "@/shared/ui/ActionMenu";
import type { IconComponent } from "@/shared/ui/icons";

const ORDER_ICON: Record<PlaybackMode, IconComponent> = {
	inOrder: LayoutArrowDown,
	repeatAll: ListRestart,
	repeatOne: Repeat1,
	shuffleTracks: Shuffle,
	shuffleAlbums: DiscAlbum,
	shuffleFolders: Folders,
	random: Dices,
};

const toneOf = (mode: PlaybackMode | null) =>
	mode === null || mode === "inOrder" ? undefined : "accent";

const keepKeyFromGlobalBindings = (event: ReactKeyboardEvent) => {
	if (event.key === "Enter" || event.key === " ") event.stopPropagation();
};

export function PlaybackOrderButton({
	order,
	className,
	size,
	disabled = false,
	isSurfaceOpen = true,
}: {
	order: ReturnType<typeof usePlaybackOrder>;
	className: string;
	size: number;
	disabled?: boolean;
	isSurfaceOpen?: boolean;
}) {
	const t = useTranslate();
	const [anchor, setAnchor] = useState<Point | null>(null);
	const buttonRef = useRef<HTMLButtonElement>(null);

	const isDrawn = order.offered.length >= 2;
	const isList = order.offered.length > 2;

	const isListOpen = isList && anchor !== null;

	const press = () => {
		if (!isList) {
			const other = order.offered.find((mode) => mode !== order.mode);
			if (other) order.setOrder(other);
			return;
		}
		const box = buttonRef.current?.getBoundingClientRect();
		if (box) setAnchor({ x: box.left, y: box.top });
	};

	useKeymap(
		SCOPE.global,
		{ playbackOrder: press },
		{ enabled: isDrawn && !disabled && isSurfaceOpen },
	);

	if (!isDrawn) return null;

	const current = order.mode ? order.nameOf(order.mode) : null;
	const name = current
		? t("player.playbackMode", { order: current })
		: t("player.order.title");
	const Icon = order.mode ? ORDER_ICON[order.mode] : CircleQuestionMark;

	return (
		<>
			<button
				ref={buttonRef}
				type="button"
				className={className}
				aria-label={
					disabled ? t("player.controlOffName", { control: name }) : name
				}
				aria-haspopup={isList ? "menu" : undefined}
				aria-expanded={isList ? isListOpen : undefined}
				aria-disabled={disabled || undefined}
				data-tone={toneOf(order.mode)}
				title={name}
				onClick={disabled ? undefined : press}
				onKeyDown={keepKeyFromGlobalBindings}
			>
				<Icon size={size} strokeWidth={2} />
			</button>
			{isList ? (
				<ActionMenu
					isOpen={isListOpen}
					anchor={anchor}
					header={{ title: t("player.order.title") }}
					actions={order.offered.map((mode) => ({
						id: mode,
						label: order.nameOf(mode),
						icon: ORDER_ICON[mode],
						iconTone: toneOf(mode),
						checked: mode === order.mode,
						onSelect: () => order.setOrder(mode),
					}))}
					onDismiss={() => setAnchor(null)}
				/>
			) : null}
		</>
	);
}
