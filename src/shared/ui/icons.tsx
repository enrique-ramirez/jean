import { Pause, Play, SkipBack, SkipForward } from "lucide-react";
import type { ComponentProps, ComponentType } from "react";

// Lucide is stroke-based, which reads too light for the transport. Filling with currentColor and keeping a thin stroke keeps lucide's rounded joins.
// fill and strokeWidth come after the spread deliberately: a caller passing strokeWidth={2} should not be able to un-solid them.
const solid = (
	Icon: ComponentType<ComponentProps<typeof Play>>,
	strokeWidth = 1.5,
) =>
	function SolidIcon(props: ComponentProps<typeof Play>) {
		return <Icon {...props} fill="currentColor" strokeWidth={strokeWidth} />;
	};

export const PlayIcon = solid(Play);
export const PauseIcon = solid(Pause);
export const SkipBackIcon = solid(SkipBack, 1.25);
export const SkipForwardIcon = solid(SkipForward, 1.25);
