import { ChevronLeft } from "lucide-react";
import type { ReactNode } from "react";

import styles from "./Crumb.module.css";

export function Crumb({
	href,
	children,
}: {
	href: string;
	children: ReactNode;
}) {
	return (
		<a className={styles.crumb} href={href}>
			<ChevronLeft
				className={styles.chevron}
				size={13}
				strokeWidth={2.5}
				aria-hidden="true"
			/>
			{children}
		</a>
	);
}
