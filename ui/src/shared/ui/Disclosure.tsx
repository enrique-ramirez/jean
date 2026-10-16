import { ChevronDown } from "lucide-react";
import { type ReactNode, useId, useState } from "react";

import styles from "./Disclosure.module.css";

export function Disclosure({
	title,
	className,
	children,
}: {
	title: string;
	className?: string;
	children: ReactNode;
}) {
	const [isOpen, setOpen] = useState(false);
	const region = useId();

	return (
		<section className={className}>
			<h2 className={styles.heading}>
				<button
					type="button"
					className={styles.trigger}
					aria-expanded={isOpen}
					aria-controls={region}
					onClick={() => setOpen((open) => !open)}
				>
					<span>{title}</span>
					<ChevronDown className={styles.chevron} aria-hidden="true" />
				</button>
			</h2>

			<div id={region} className={styles.region} hidden={!isOpen}>
				{children}
			</div>
		</section>
	);
}
