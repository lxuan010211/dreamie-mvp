import { spawn } from 'node:child_process';

export function playAudioOnMac(filePath: string): void {
  const player = spawn('afplay', [filePath], {
    detached: true,
    stdio: 'ignore',
  });

  player.unref();
}
