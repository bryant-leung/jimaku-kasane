// kuromoji's loader only uses path.join(dir, file); the extension serves files by URL.
export const join = (...parts: string[]) => parts.filter(Boolean).join('/').replace(/\/+/g, '/');
export default { join };
