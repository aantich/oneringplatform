import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const apiDirectory = fileURLToPath(new URL('..', import.meta.url));

export type EnvironmentLoadResult = {
  file: string;
  loaded: boolean;
};

export function loadPlatformEnvironment(): EnvironmentLoadResult {
  const configuredFile = process.env.PLATFORM_ENV_FILE ?? process.env.ONERINGAI_ENV_FILE;
  const baseDirectory = process.env.INIT_CWD ?? process.cwd();
  const file = configuredFile
    ? path.resolve(baseDirectory, configuredFile)
    : path.join(apiDirectory, '.env');
  const result = dotenv.config({ path: file, quiet: true });
  if (configuredFile && result.error) {
    throw new Error(`Unable to load PLATFORM_ENV_FILE: ${file}`);
  }
  return { file, loaded: !result.error };
}
