/** Treat a complete backdrop click like Escape, including the dialog's cancel handlers. */
export function dismissDialogOnOutsideClick(dialog: HTMLDialogElement) {
  let pointer: number | null = null;
  let releasedOutside = false;
  const outside = (event: MouseEvent) => {
    const bounds = dialog.getBoundingClientRect();
    return (
      event.target === dialog &&
      (event.clientX < bounds.left ||
        event.clientX > bounds.right ||
        event.clientY < bounds.top ||
        event.clientY > bounds.bottom)
    );
  };
  const reset = () => {
    pointer = null;
    releasedOutside = false;
  };
  dialog.addEventListener('pointerdown', (event) => {
    reset();
    if (dialog.open && event.isPrimary && event.button === 0 && outside(event))
      pointer = event.pointerId;
  });
  dialog.addEventListener('pointerup', (event) => {
    releasedOutside = pointer === event.pointerId && event.button === 0 && outside(event);
    pointer = null;
  });
  dialog.addEventListener('pointercancel', reset);
  dialog.addEventListener('close', reset);
  dialog.addEventListener('click', (event) => {
    const dismiss = releasedOutside && dialog.open && outside(event);
    reset();
    if (dismiss && dialog.dispatchEvent(new Event('cancel', { cancelable: true })) && dialog.open)
      dialog.close();
  });
}
