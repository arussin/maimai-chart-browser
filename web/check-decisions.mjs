/** Each extracted pure decision module must meet its own branch-coverage threshold. */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
for (const name of [
  'analysis-model',
  'artwork',
  'song-model',
  'catalog-genres',
  'challenge-matching',
]) {
  const result = spawnSync(
    process.execPath,
    [
      '--test',
      '--experimental-test-coverage',
      `--test-coverage-include=**/domain/${name}.ts`,
      '--test-coverage-branches=95',
      `tests/${name}.test.mjs`,
    ],
    { cwd: fileURLToPath(new URL('.', import.meta.url)), stdio: 'inherit' },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
