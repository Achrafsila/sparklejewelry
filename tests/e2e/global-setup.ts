import { execSync } from 'node:child_process';

/** Starts the local stack if needed; each spec file resets the database itself. */
export default function globalSetup() {
  execSync('bash dev/stack.sh start', { stdio: 'ignore' });
}
