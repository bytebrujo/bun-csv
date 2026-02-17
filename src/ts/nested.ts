/**
 * Nested JSON support - flatten/unflatten utilities for dot-notation CSV headers.
 *
 * Allows converting between:
 *   { user: { name: "Alice", address: { city: "NYC" } } }
 * and flat dot-notation:
 *   { "user.name": "Alice", "user.address.city": "NYC" }
 */

/**
 * Flatten a nested object into dot-notation keys.
 *
 * @param obj The nested object to flatten
 * @param separator Key separator (default: ".")
 * @param prefix Internal prefix for recursion
 * @returns Flat object with dot-notation keys
 *
 * @example
 * ```ts
 * flatten({ user: { name: "Alice", age: 30 } })
 * // => { "user.name": "Alice", "user.age": 30 }
 *
 * flatten({ a: { b: { c: 1 } }, d: 2 })
 * // => { "a.b.c": 1, "d": 2 }
 * ```
 */
export function flatten(
  obj: Record<string, unknown>,
  separator: string = ".",
  prefix: string = "",
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const key of Object.keys(obj)) {
    const fullKey = prefix ? prefix + separator + key : key;
    const value = obj[key];

    if (
      value !== null &&
      value !== undefined &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      !(value instanceof Date)
    ) {
      // Recurse into nested objects
      Object.assign(result, flatten(value as Record<string, unknown>, separator, fullKey));
    } else {
      result[fullKey] = value;
    }
  }

  return result;
}

/**
 * Unflatten a flat object with dot-notation keys into a nested structure.
 *
 * @param obj Flat object with dot-notation keys
 * @param separator Key separator (default: ".")
 * @returns Nested object
 *
 * @example
 * ```ts
 * unflatten({ "user.name": "Alice", "user.age": "30", "city": "NYC" })
 * // => { user: { name: "Alice", age: "30" }, city: "NYC" }
 * ```
 */
export function unflatten(
  obj: Record<string, unknown>,
  separator: string = ".",
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const key of Object.keys(obj)) {
    const parts = key.split(separator);
    let current: Record<string, unknown> = result;

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i]!;
      if (!(part in current) || typeof current[part] !== "object" || current[part] === null) {
        current[part] = {};
      }
      current = current[part] as Record<string, unknown>;
    }

    current[parts[parts.length - 1]!] = obj[key];
  }

  return result;
}

/**
 * Flatten an array of nested objects for CSV serialization.
 * Collects all unique dot-notation keys across all objects.
 *
 * @param objects Array of potentially nested objects
 * @param separator Key separator (default: ".")
 * @returns { headers: string[], rows: unknown[][] }
 */
export function flattenObjects(
  objects: Record<string, unknown>[],
  separator: string = ".",
): { headers: string[]; rows: unknown[][] } {
  // Flatten all objects and collect headers
  const flatObjects = objects.map(obj => flatten(obj, separator));

  const headerSet = new Set<string>();
  for (const flat of flatObjects) {
    for (const key of Object.keys(flat)) {
      headerSet.add(key);
    }
  }

  const headers = Array.from(headerSet);
  const rows = flatObjects.map(flat => headers.map(h => flat[h] ?? null));

  return { headers, rows };
}
