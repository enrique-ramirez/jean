import { Shuffle } from "lucide-react";

import type { usePlaybackOrder } from "@/domain/player/usePlayer";
import { useTranslate } from "@/shared/i18n/useTranslate";

export function ShuffleToggle({
	order,
	className,
	size,
}: {
	order: ReturnType<typeof usePlaybackOrder>;
	className: string;
	size: number;
}) {
	const t = useTranslate();
	return (
		<button
			type="button"
			className={className}
			aria-label={t("player.shuffle")}
			aria-pressed={order.isShuffle}
			disabled={!order.canShuffle}
			title={
				order.orderName
					? t("player.playbackMode", { order: order.orderName })
					: t("player.shuffle")
			}
			onClick={order.toggleShuffle}
		>
			<Shuffle size={size} strokeWidth={2} />
		</button>
	);
}
