import { Shuffle } from "lucide-react";

import type { usePlaybackOrder } from "@/domain/player/usePlayer";

export function ShuffleToggle({
	order,
	className,
	size,
}: {
	order: ReturnType<typeof usePlaybackOrder>;
	className: string;
	size: number;
}) {
	return (
		<button
			type="button"
			className={className}
			aria-label="Shuffle"
			aria-pressed={order.isShuffle}
			disabled={!order.canShuffle}
			title={order.orderName ? `Playback order: ${order.orderName}` : "Shuffle"}
			onClick={order.toggleShuffle}
		>
			<Shuffle size={size} strokeWidth={2} />
		</button>
	);
}
