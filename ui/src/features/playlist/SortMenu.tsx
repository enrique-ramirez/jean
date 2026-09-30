import { ArrowDownAZ } from "lucide-react";
import { useState } from "react";
import { ORDERINGS } from "@/domain/track/playlistOrderings";
import { useTranslate } from "@/shared/i18n/useTranslate";
import { ActionMenu } from "@/shared/ui/ActionMenu";
import { Button } from "@/shared/ui/Button";

export function SortMenu({
	onSort,
}: {
	onSort: (pattern: string, ordering: string) => void;
}) {
	const t = useTranslate();
	const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);

	return (
		<>
			<Button
				icon={ArrowDownAZ}
				aria-haspopup="menu"
				aria-expanded={anchor !== null}
				onClick={(event) => {
					const box = event.currentTarget.getBoundingClientRect();
					setAnchor({ x: box.left, y: box.bottom });
				}}
				onKeyDown={(event) => {
					if (event.key === "Enter") event.stopPropagation();
				}}
			>
				{t("playlist.sort")}
			</Button>
			<ActionMenu
				isOpen={anchor !== null}
				anchor={anchor}
				header={{ title: t("playlist.sortHeading") }}
				actions={ORDERINGS.map(({ id, label, pattern }) => ({
					id,
					label: t(label),
					onSelect: () => onSort(pattern, t(label)),
				}))}
				onDismiss={() => setAnchor(null)}
			/>
		</>
	);
}
