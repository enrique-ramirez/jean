import { Pause, Play, SkipBack, SkipForward } from "lucide-react";
import type { ComponentProps, ComponentType } from "react";

export type IconComponent = ComponentType<{
	className?: string;
	size?: number;
	strokeWidth?: number;
	"aria-hidden"?: boolean | "true" | "false";
}>;

// `fill` and `strokeWidth` come after the spread deliberately: a caller passing `strokeWidth={2}`
// must not be able to un-solid these.
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
