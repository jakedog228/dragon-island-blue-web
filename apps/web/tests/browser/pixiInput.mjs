

























export function tapPixiLabel(page, label) {
  return page.evaluate((wanted) => {
    const shown = (node) => {
      for (let current = node; current; current = current.parent) {
        if (!current.visible || !current.renderable) return false;
      }
      return true;
    };
    const ownerKind = (node) => {
      const count = (type) => node.listenerCount?.(type) ?? 0;
      // Modal PopupMenu callers install one generic pointertap swallow before the shared builder
      // installs its parent-owned item dispatcher. They also swallow down/up, but those are not a
      // ButtonSprite sequence: choosing "press" there means the row can never invoke. A root with
      // two tap listeners is therefore the menu tap owner. MonsterManagement/PartyEditor roots
      // keep one tap stopper plus their real down/up arbitration and remain press owners.
      if (count("pointertap") >= 2) return "tap";
      if (count("pointerdown") > 0 && count("pointerup") > 0) return "press";
      if (count("pointertap") > 0) return "tap";
      return null;
    };
    const stack = [window.__PIXI_APP__.stage];
    let node = null;
    while (stack.length > 0) {
      const current = stack.pop();
      if (current?.label === wanted && shown(current)) { node = current; break; }
      if (current?.children) stack.push(...current.children);
    }
    if (!node) throw new Error(`missing visible Pixi node ${wanted}`);
    let target = node;
    let kind = ownerKind(target);
    while (target !== null && kind === null) {
      target = target.parent ?? null;
      kind = target === null ? null : ownerKind(target);
    }
    if (target === null) throw new Error(`no pointer listener owns ${wanted}`);
    let global;
    if (target !== node) {
      // PopupMenu's labelled row container includes the stretched/animated MenuButton2 plate in
      // its local bounds. That visual union can have a centre outside the source label rectangle
      // that the parent-owned menuItems dispatcher arbitrates. Prefer the actual visible Text
      // descendant's global centre; MonsterManagement's sprite-only rows fall back to the node.
      const descendants = [...(node.children ?? [])];
      let textNode = null;
      while (descendants.length > 0) {
        const candidate = descendants.pop();
        if (typeof candidate?.text === "string" && shown(candidate)) {
          textNode = candidate;
          break;
        }
        if (candidate?.children) descendants.push(...candidate.children);
      }
      if (textNode !== null) {
        const textBounds = textNode.getBounds();
        global = {
          x: textBounds.x + textBounds.width / 2,
          y: textBounds.y + textBounds.height / 2,
        };
      }
    }
    if (global === undefined) {
      const bounds = node.getLocalBounds();
      const centre = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
      global = node.toGlobal(centre);
    }
    const local = target.toLocal(global);
    const event = {
      pointerId: 1,
      global,
      getLocalPosition: () => ({ x: local.x, y: local.y }),
      stopPropagation() {},
      stopImmediatePropagation() {},
    };
    if (kind === "press") {
      // `-[ButtonSprite ccTouchBegan:]`/`ccTouchEnded:` (and the MonsterManagement root's own
      // began/release pair) resolve on the sequence, not on a synthesized tap.
      target.emit("pointerdown", event);
      target.emit("pointerup", event);
    } else {
      target.emit("pointertap", event);
    }
    return target.label ?? "(unlabelled owner)";
  }, label);
}

/** True when a node with this label is mounted, visible, and renderable to its root. */
export function pixiLabelVisible(page, label) {
  return page.evaluate((wanted) => {
    const stack = [window.__PIXI_APP__.stage];
    while (stack.length > 0) {
      const node = stack.pop();
      if (node?.label === wanted) {
        for (let current = node; current; current = current.parent) {
          if (!current.visible || !current.renderable) return false;
        }
        return true;
      }
      if (node?.children) stack.push(...node.children);
    }
    return false;
  }, label);
}
