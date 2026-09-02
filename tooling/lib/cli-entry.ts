import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Cross-platform equivalent of "is this module the CLI entry point?" */
export function isMain(importMetaUrl: string, argvEntry: string | undefined = process.argv[1]): boolean {
  if (argvEntry === undefined || argvEntry.trim() === '') return false;
  return importMetaUrl === pathToFileURL(resolve(argvEntry)).href;
}
