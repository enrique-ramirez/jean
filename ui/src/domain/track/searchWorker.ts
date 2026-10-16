import { libraryStore } from "./libraryStoreDb";
import { type SearchPort, serveSearch } from "./searchChannel";

serveSearch(self as unknown as SearchPort, libraryStore(__JEAN_BUILD__));
