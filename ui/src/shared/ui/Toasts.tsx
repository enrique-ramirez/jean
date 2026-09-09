import { Check, TriangleAlert, X } from "lucide-react";
import { useTranslate } from "@/shared/i18n/useTranslate";
import styles from "./Toasts.module.css";
import { dismissToast, useToasts } from "./toastStore";

const ICONS = { default: Check, error: TriangleAlert };

export function Toasts() {
	const t = useTranslate();
	const toasts = useToasts();
	if (toasts.length === 0) return null;

	return (
		<div className={styles.layer} role="status" aria-live="polite">
			{toasts.map((toast) => {
				const Icon = ICONS[toast.tone] ?? ICONS.default;

				return (
					<div key={toast.id} className={styles.toast} data-tone={toast.tone}>
						<Icon
							className={styles.icon}
							size={15}
							strokeWidth={2.2}
							aria-hidden="true"
						/>
						<p className={styles.message}>{toast.message}</p>

						{toast.action ? (
							<button
								type="button"
								className={styles.action}
								onClick={() => {
									dismissToast(toast.id);
									toast.action?.run();
								}}
							>
								{toast.action.label}
							</button>
						) : null}

						<button
							type="button"
							className={styles.close}
							aria-label={t("action.dismiss")}
							onClick={() => dismissToast(toast.id)}
						>
							<X size={13} strokeWidth={2.2} aria-hidden="true" />
						</button>
					</div>
				);
			})}
		</div>
	);
}
