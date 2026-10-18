export async function dialogPoints(dialog) {
  return dialog.evaluate(node => {
    const bounds = node.getBoundingClientRect();
    const outside = [{x: 1, y: 1}, {x: innerWidth - 1, y: innerHeight - 1}].find(
      point => point.x < bounds.left || point.x > bounds.right || point.y < bounds.top || point.y > bounds.bottom,
    );
    if (!outside) throw Error('The dialog must leave a visible backdrop for this interaction.');
    return {inside: {x: bounds.left + 8, y: bounds.top + 8}, outside};
  });
}

export async function clickOutsideDialog(page, dialog) {
  const {outside} = await dialogPoints(dialog);
  await page.mouse.click(outside.x, outside.y);
}

export async function dragOutsideDialog(page, dialog) {
  const {inside, outside} = await dialogPoints(dialog);
  await page.mouse.move(inside.x, inside.y);
  await page.mouse.down();
  await page.mouse.move(outside.x, outside.y, {steps: 5});
  await page.mouse.up();
}
