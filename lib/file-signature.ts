const EXTENSIONS: Record<string, string> = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'application/pdf': '.pdf' };

/** The extension is derived from the verified content type, never from the user-supplied file name. */
export function extensionForType(mimeType: string) {
  return EXTENSIONS[mimeType] || '';
}

/** Confirms the leading bytes match the declared content type so a mislabelled file cannot be stored. */
export function matchesDeclaredType(bytes: Uint8Array, mimeType: string) {
  const starts = (signature: number[], offset = 0) => signature.every((value, index) => bytes[offset + index] === value);
  switch (mimeType) {
    case 'image/jpeg': return starts([0xff, 0xd8, 0xff]);
    case 'image/png': return starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case 'image/webp': return starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8);
    case 'application/pdf': return starts([0x25, 0x50, 0x44, 0x46, 0x2d]);
    default: return false;
  }
}
