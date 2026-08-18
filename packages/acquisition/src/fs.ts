import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * The filesystem is injected so that the local artifact store and the fixture
 * provider — the two things CI depends on most — can be exercised without
 * touching a disk, while still defaulting to the real thing in production.
 */
export interface ReadOnlyFileSystem {
  readFile(path: string): Promise<Uint8Array>;
  exists(path: string): Promise<boolean>;
}

export interface WritableFileSystem extends ReadOnlyFileSystem {
  /** Create a directory and any missing parents. */
  mkdir(directory: string): Promise<void>;
  writeFile(path: string, data: Uint8Array): Promise<void>;
}

export const nodeFileSystem: WritableFileSystem = {
  async readFile(path: string): Promise<Uint8Array> {
    const buffer = await readFile(path);
    return new Uint8Array(buffer);
  },
  async exists(path: string): Promise<boolean> {
    try {
      await readFile(path);
      return true;
    } catch {
      return false;
    }
  },
  async mkdir(directory: string): Promise<void> {
    await mkdir(directory, { recursive: true });
  },
  async writeFile(path: string, data: Uint8Array): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data);
  },
};

/** Hermetic filesystem for unit tests and for building fixture sets in memory. */
export class InMemoryFileSystem implements WritableFileSystem {
  readonly #files = new Map<string, Uint8Array>();

  constructor(initial: Readonly<Record<string, string | Uint8Array>> = {}) {
    for (const [path, content] of Object.entries(initial)) {
      this.#files.set(
        normalize(path),
        typeof content === 'string' ? new TextEncoder().encode(content) : content,
      );
    }
  }

  readFile(path: string): Promise<Uint8Array> {
    const file = this.#files.get(normalize(path));
    if (file === undefined) {
      return Promise.reject(new Error(`ENOENT: no such file '${path}'`));
    }
    return Promise.resolve(file);
  }

  exists(path: string): Promise<boolean> {
    return Promise.resolve(this.#files.has(normalize(path)));
  }

  mkdir(): Promise<void> {
    return Promise.resolve();
  }

  writeFile(path: string, data: Uint8Array): Promise<void> {
    this.#files.set(normalize(path), data);
    return Promise.resolve();
  }

  /** Paths currently held, normalised to forward slashes. Test affordance. */
  paths(): readonly string[] {
    return [...this.#files.keys()].sort();
  }

  get size(): number {
    return this.#files.size;
  }
}

function normalize(path: string): string {
  return path.replace(/\\/g, '/');
}
