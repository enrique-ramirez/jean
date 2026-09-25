import { Shuffle } from "lucide-react";

import type { usePlaybackOrder } from "@/domain/player/usePlayer";
import { useTranslate } from "@/shared/i18n/useTranslate";

export function ShuffleToggle({
	order,
	className,
	size,
	disabled = false,
}: {
	order: ReturnType<typeof usePlaybackOrder>;
	className: string;
	size: number;
	disabled?: boolean;
}) {
	const t = useTranslate();
	const baseLabel = t("player.shuffle");

	return (
		<button
			type="button"
			className={className}
			aria-label={
				disabled
					? t("player.controlOffName", { control: baseLabel })
					: baseLabel
			}
			aria-pressed={order.isShuffle}
			aria-disabled={disabled || undefined}
			disabled={!disabled && !order.canShuffle}
			title={
				order.orderName
					? t("player.playbackMode", { order: order.orderName })
					: baseLabel
			}
			onClick={disabled ? undefined : order.toggleShuffle}
		>
			<Shuffle size={size} strokeWidth={2} />
		</button>
	);
}
