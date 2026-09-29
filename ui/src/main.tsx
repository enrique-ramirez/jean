import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "@/app/App";
import { followPollWith } from "@/domain/player/playerPoll";
import { libraryPollFollower } from "@/domain/track/libraryLoader";
import { startLocale } from "@/shared/i18n/locale";
import "@/shared/styles/global.css";

const queryClient = new QueryClient();

followPollWith(libraryPollFollower);

await startLocale();

createRoot(document.getElementById("root") as HTMLElement).render(
	<StrictMode>
		<QueryClientProvider client={queryClient}>
			<App />
		</QueryClientProvider>
	</StrictMode>,
);
