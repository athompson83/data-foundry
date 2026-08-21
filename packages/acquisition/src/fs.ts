import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

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
  /** Every file at or under a path prefix. Missing prefixes list as empty. */
  listFiles(prefix: string): Promise<readonly string[]>;
  /** Remove one file. A missing file is not an error. */
  remove(path: string): Promise<void>;
  /** Last-modified epoch milliseconds, or null when the file is gone. */
  modifiedAt(path: string): Promise<number | null>;
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
  async listFiles(prefix: string): Promise<readonly string[]> {
    const found: string[] = [];
    const walk = async (directory: string): Promise<void> => {
      let entries;
      try {
        entries = await readdir(directory, { withFileTypes: true });
      } catch {
        return; // A prefix that does not exist holds no files.
      }
      for (const entry of entries) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) await walk(path);
        else found.push(normalize(path));
      }
    };
    await walk(prefix);
    return found.sort();
  },
  async remove(path: string): Promise<void> {
    await rm(path, { force: true });
  },
  async modifiedAt(path: string): Promise<number | null> {
    try {
      return (await stat(path)).mtimeMs;
    } catch {
      return null;
    }
  },
};

/** Hermetic filesystem for unit tests and for building fixture sets in memory. */
export class InMemoryFileSystem implements WritableFileSystem {
  readonly #files = new Map<string, Uint8Array>();
  readonly #modified = new Map<string, number>();
  /**
   * Write time, overridable so an age-based sweep can be tested without
   * sleeping. Deliberately not `Date.now` by default in tests that set it.
   */
  clock: () => number = () => Date.now();

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
    this.#modified.set(normalize(path), this.clock());
    return Promise.resolve();
  }

  listFiles(prefix: string): Promise<readonly string[]> {
    const normalized = normalize(prefix);
    return Promise.resolve(this.paths().filter((path) => path.startsWith(normalized)));
  }

  remove(path: string): Promise<void> {
    this.#files.delete(normalize(path));
    this.#modified.delete(normalize(path));
    return Promise.resolve();
  }

  modifiedAt(path: string): Promise<number | null> {
    return Promise.resolve(this.#modified.get(normalize(path)) ?? null);
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
