import { ListEnd } from "lucide-react";

import { QUEUE_DROP_TARGET } from "@/domain/player/queue";
import { useQueue, useQueueActions } from "@/domain/player/useQueue";
import { useTranslate } from "@/shared/i18n/useTranslate";
import { useDragState } from "@/shared/ui/dnd";
import styles from "./QueueButton.module.css";

const BADGE_MAX = 99;

export function QueueButton({
	isOpen,
	onToggle,
	variant = "bar",
}: {
	isOpen: boolean;
	onToggle: () => void;
	variant?: "bar" | "screen";
}) {
	const t = useTranslate();
	const { count } = useQueue();
	const { canControlPlayback } = useQueueActions();
	const drag = useDragState();

	return (
		<button
			type="button"
			className={styles.queue}
			aria-label={
				count === 0 ? t("queue.title") : t("queue.withCount", { count })
			}
			aria-expanded={isOpen}
			data-open={isOpen}
			data-size={variant}
			data-queue-toggle=""
			data-drop-target={drag.isDragging ? QUEUE_DROP_TARGET : undefined}
			data-drop-over={drag.over === QUEUE_DROP_TARGET ? "true" : undefined}
			data-drop-refuses={
				canControlPlayback ? undefined : t("player.controlOff")
			}
			onClick={onToggle}
		>
			<ListEnd size={18} strokeWidth={2} aria-hidden="true" />

			{count > 0 ? (
				<span key={count} className={styles.badge} aria-hidden="true">
					{count > BADGE_MAX ? `${BADGE_MAX}+` : count}
				</span>
			) : null}
		</button>
	);
}
