export function createMainWindowOptions({
  rendererUrl,
}: {
  rendererUrl: string;
}) {
  return {
    title: "Knowdisk",
    url: rendererUrl,
    frame: {
      width: 1400,
      height: 900,
      x: 120,
      y: 100,
    },
    titleBarStyle: "hiddenInset" as const,
  };
}
