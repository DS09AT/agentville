import nodePath from 'node:path';

// Returns the part of the path below the root, written with forward slashes, or null when it is not inside.
export function within(root, path, p = nodePath) {
  if (typeof root !== 'string' || typeof path !== 'string' || !root || !p.isAbsolute(path)) return null;
  const rel = p.relative(root, path);
  if (!rel || rel === '..' || rel.startsWith(`..${p.sep}`) || p.isAbsolute(rel)) return null;
  return rel.split(p.sep).join('/');
}

// Windows compares ignoring case and slash kind, as path.relative does.
export function samePath(a, b, p = nodePath) {
  return typeof a === 'string' && typeof b === 'string' && a !== '' && b !== '' && p.isAbsolute(a) && p.isAbsolute(b) && p.relative(a, b) === '';
}
