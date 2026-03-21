/** JSON-safe serialization that converts Maps to plain objects */
export function serializeState(obj: unknown): unknown {
  if (obj instanceof Map) {
    const plain: Record<string, unknown> = {};
    for (const [k, v] of obj) {
      plain[String(k)] = serializeState(v);
    }
    return plain;
  }
  if (Array.isArray(obj)) {
    return obj.map(serializeState);
  }
  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      result[k] = serializeState(v);
    }
    return result;
  }
  return obj;
}
