export function isBrandImage(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (value.length <= 500 && /^https:\/\/[^\s"'()\\;<>{}]+$/.test(value)) return true;
  return value.length <= 131072 && /^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/.test(value);
}
