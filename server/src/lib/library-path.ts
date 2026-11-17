import fs from 'node:fs';
import path from 'node:path';

/** Restrict reads to a bot's real Library, even through symlinks or ../ paths. */
export function safeLibraryReadPath(libraryRoot: string, botId: string, requested: string): string {
  if (!/^bot_[a-zA-Z0-9_-]+$/.test(botId)) throw new Error('Invalid bot id.');
  const root = fs.realpathSync(path.join(libraryRoot, botId));
  const full = fs.realpathSync(path.isAbsolute(requested) ? requested : path.join(root, requested));
  const relative = path.relative(root, full);
  if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
    throw new Error('Only files inside your own Library may be read.');
  }
  if (!fs.statSync(full).isFile()) throw new Error('The requested path is not a regular file.');
  return full;
}
