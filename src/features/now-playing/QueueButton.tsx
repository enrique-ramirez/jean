import { ListEnd } from "lucide-react";

import { useQueue } from "@/domain/player/useQueue";
import { plural } from "@/shared/lib/text";
import styles from "./QueueButton.module.css";

const BADGE_MAX = 99;

export function QueueButton({
	isOpen,
	onToggle,
}: {
	isOpen: boolean;
	onToggle: () => void;
}) {
	const { count } = useQueue();

	return (
		<button
			type="button"
			className={styles.queue}
			aria-label={count === 0 ? "Queue" : `Queue, ${plural(count, "track")}`}
			aria-expanded={isOpen}
			data-open={isOpen}
			onClick={onToggle}
		>
			<ListEnd size={18} strokeWidth={2} aria-hidden="true" />

			{count > 0 ? (
				// Keyed by the count so a change remounts it and replays the pop.
				<span key={count} className={styles.badge} aria-hidden="true">
					{count > BADGE_MAX ? `${BADGE_MAX}+` : count}
				</span>
			) : null}
		</button>
	);
}
