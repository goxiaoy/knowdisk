import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { hydrateConfigFromBun } from "./services/config.service";

async function bootstrap() {
	await hydrateConfigFromBun();
	createRoot(document.getElementById("root")!).render(
		<StrictMode>
			<App />
		</StrictMode>,
	);
}

void bootstrap();
