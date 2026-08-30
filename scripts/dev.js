import { spawn } from 'node:child_process';

const isWindows = process.platform === 'win32';
const npmCommand = 'npm';
const children = [
  spawn(npmCommand, ['--prefix', 'server', 'run', 'dev'], { stdio: 'inherit', shell: isWindows }),
  spawn(npmCommand, ['--prefix', 'client', 'run', 'dev'], { stdio: 'inherit', shell: isWindows })
];

let stopping = false;

function stopChildren(signal = 'SIGTERM') {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (!child.killed && child.exitCode === null) child.kill(signal);
  }
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    stopChildren(signal);
    process.exitCode = 0;
  });
}

for (const child of children) {
  child.on('error', (error) => {
    console.error(`Failed to start development process: ${error.message}`);
    stopChildren();
    process.exitCode = 1;
  });
  child.on('exit', (code, signal) => {
    if (stopping) return;
    stopChildren();
    process.exitCode = code ?? (signal ? 1 : 0);
  });
}
