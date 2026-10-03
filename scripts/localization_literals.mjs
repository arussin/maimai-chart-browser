// Minification can fold path templates and concatenate already classified markup.
// Keep protocol recognition separate from the exact prose classification catalog.
const pathToken = /[MmLlHhVvCcSsQqTtAaZz,\s]+|[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/y;
export function isSvgPath(value) {
  if (!/^[Mm]\s*[+-]?(?:\d+(?:\.\d*)?|\.\d+)/.test(value)) return false;
  // Advance one complete token at a time. A repeated numeric regex can explore
  // exponentially many splits before rejecting a malformed trailing word.
  let offset = 0;
  while (offset < value.length) {
    pathToken.lastIndex = offset;
    if (!pathToken.test(value)) return false;
    offset = pathToken.lastIndex;
  }
  return true;
}

export function createLiteralClassifier(known) {
  // Only complete classified markup fragments may compose. Never strip tags or
  // accept an arbitrary substring: visible text and accessible attributes count.
  const fragments = [...known].filter((value) => /^<\/?[a-zA-Z][a-zA-Z0-9:-]*(?:\s|>)/.test(value) && value.endsWith('>'));
  return (value) => {
    if (known.has(value)) return true;
    if (!value.startsWith('<')) return false;
    const positions = new Set([0]);
    for (const start of positions) {
      for (const fragment of fragments) {
        if (value.startsWith(fragment, start)) {
          const end = start + fragment.length;
          if (end === value.length) return true;
          positions.add(end);
        }
      }
    }
    return false;
  };
}
