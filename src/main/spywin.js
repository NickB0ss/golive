'use strict';

function validBounds(bounds) {
  return bounds && ['x', 'y', 'width', 'height'].every((key) => Number.isFinite(bounds[key])) && bounds.width > 0 && bounds.height > 0;
}

function parseStoredBounds(json) {
  try {
    const bounds = JSON.parse(json);
    return validBounds(bounds) ? { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height } : null;
  } catch {
    return null;
  }
}

function clampBounds(bounds, displays, fallback) {
  if (!validBounds(bounds) || !Array.isArray(displays) || !displays.length) return fallback;
  const display = displays.find((item) => {
    const box = item?.bounds;
    return box && bounds.x < box.x + box.width && bounds.x + bounds.width > box.x && bounds.y < box.y + box.height && bounds.y + bounds.height > box.y;
  });
  if (!display?.bounds) return fallback;
  const box = display.bounds;
  return {
    x: Math.max(box.x, Math.min(bounds.x, box.x + box.width - bounds.width)),
    y: Math.max(box.y, Math.min(bounds.y, box.y + box.height - bounds.height)),
    width: Math.min(bounds.width, box.width),
    height: Math.min(bounds.height, box.height),
  };
}

module.exports = { clampBounds, parseStoredBounds };
