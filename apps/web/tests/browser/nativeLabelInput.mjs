// Read a rendered control's coordinates, then use the browser's real mouse dispatch.
// Unlike tapPixiLabel this never emits events or invokes a Pixi listener directly.
export async function clickNativeLabel(page, label) {
  const point = await page.evaluate(wanted => {
    const app = window.__PIXI_APP__; app.render();
    const stack = [app.stage];
    const shown = node => {
      for (; node; node = node.parent) if (!node.visible || !node.renderable) return false;
      return true;
    };
    while (stack.length) {
      const node = stack.pop();
      if (node.label === wanted && shown(node)) {
        const hit = node.hitArea, bounds = node.getBounds();
        const p = hit && [hit.x, hit.y, hit.width, hit.height].every(Number.isFinite)
          ? node.toGlobal({ x: hit.x + hit.width / 2, y: hit.y + hit.height / 2 })
          : { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
        const box = app.canvas.getBoundingClientRect();
        return { x: box.x + p.x * box.width / app.screen.width,
          y: box.y + p.y * box.height / app.screen.height };
      }
      if (node.children) stack.push(...node.children);
    }
    throw new Error(`Missing visible control ${wanted}`);
  }, label);
  await page.mouse.click(point.x, point.y);
  return true;
}

export async function waitNativeLabel(page, label) {
  for (let attempt = 0; attempt < 1000; attempt++) {
    const ready = await page.evaluate(wanted => {
      const stack = [window.__PIXI_APP__.stage];
      while (stack.length) {
        const node = stack.pop();
        if (node.label === wanted) {
          let alpha = 1;
          for (let current = node; current; current = current.parent) {
            if (!current.visible || !current.renderable) return false;
            alpha *= current.alpha;
          }
          return alpha > 0.999;
        }
        if (node.children) stack.push(...node.children);
      }
      return false;
    }, label);
    if (ready) return;
    await page.evaluate(() => window.advanceTime(50));
    await page.waitForTimeout(5);
  }
  throw new Error(`Control did not finish presenting: ${label}`);
}
