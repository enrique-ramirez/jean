import { Shuffle } from "lucide-react";

import type { usePlaybackOrder } from "@/domain/player/usePlayer";

/**
 * Shuffle as the *mode*, in the status bar and in the screen's transport. The caller supplies the class and the glyph size, because the control is quieter and smaller in the bar than it is under a thumb — what must not differ between the two is what it announces itself as and what it says the order currently is.
 *
 * The order is handed in rather than read here: `usePlaybackOrder` remembers the order to come back to when shuffle goes off, and a copy of it inside a control that unmounts with the compact screen would forget it every time the screen was closed.
 *
 * The action that starts a shuffled set is `PlayActions`, in a view's header, and is a different control.
 */
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
