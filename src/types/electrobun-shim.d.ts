declare module "electrobun/bun" {
  export const BrowserView: any;
  export class BrowserWindow {
    constructor(options: any);
    on(event: string, listener: (...args: any[]) => void): void;
  }
  export const Updater: any;
  export const Utils: any;
}

declare module "electrobun/view" {
  const value: any;
  export default value;
}
