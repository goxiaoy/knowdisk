const DEV_SERVER_PORT = 5173;
const DEV_SERVER_URL = `http://localhost:${DEV_SERVER_PORT}`;
const PROD_VIEW_URL = "views://app/index.html";

export type MainWindowOptions = {
	title: string;
	url: string;
	width: number;
	height: number;
};

export function createWindowOptions(): MainWindowOptions {
	return {
		title: "KnowDisk",
		url:
			process.env.ELECTROBUN_RENDERER_URL?.trim() ||
			(process.env.NODE_ENV === "development" ? DEV_SERVER_URL : PROD_VIEW_URL),
		width: 1320,
		height: 860,
	};
}

export async function bootstrapApp() {
	const { BrowserWindow } = await import("electrobun/bun");

	return new BrowserWindow(createWindowOptions());
}

if (import.meta.main) {
	void bootstrapApp();
}
