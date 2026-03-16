const CONTEXT_MENU_PADDING = 8;

export function resolveContextMenuPosition(input: {
  anchor: { x: number; y: number };
  containerRect: { left: number; top: number; width: number; height: number };
  menuSize: { width: number; height: number };
}): { left: number; top: number } {
  const rawLeft = input.anchor.x - input.containerRect.left;
  const rawTop = input.anchor.y - input.containerRect.top;
  const maxLeft = Math.max(
    CONTEXT_MENU_PADDING,
    input.containerRect.width - input.menuSize.width - CONTEXT_MENU_PADDING
  );
  const maxTop = Math.max(
    CONTEXT_MENU_PADDING,
    input.containerRect.height - input.menuSize.height - CONTEXT_MENU_PADDING
  );

  return {
    left: Math.min(Math.max(CONTEXT_MENU_PADDING, rawLeft), maxLeft),
    top: Math.min(Math.max(CONTEXT_MENU_PADDING, rawTop), maxTop),
  };
}
