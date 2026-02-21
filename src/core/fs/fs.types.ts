export type FsEvent =
  | { type: "renamed"; path: string; nextPath: string }
  | { type: "updated"; path: string };
