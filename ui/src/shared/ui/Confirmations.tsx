import { AlertDialog } from "./AlertDialog";
import { answerConfirmation, useConfirmation } from "./confirmStore";

export function Confirmations() {
	const question = useConfirmation();
	if (!question) return null;

	return (
		<AlertDialog
			title={question.title}
			body={question.body}
			actions={[
				{
					label: question.confirm,
					onSelect: () => answerConfirmation(true),
				},
				{
					label: question.decline,
					onSelect: () => answerConfirmation(false),
					keyHint: "Enter",
					isDefault: true,
				},
			]}
		/>
	);
}
