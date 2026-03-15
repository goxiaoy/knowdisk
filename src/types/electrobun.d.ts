declare module "electrobun/bun" {
	export class BrowserWindow {
		constructor(options: {
			title?: string;
			url: string;
			width?: number;
			height?: number;
		});
	}
}
