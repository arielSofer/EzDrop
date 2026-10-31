/** Opt-in installer integration test. Downloads several GB into an isolated temporary environment. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-setup-integration-'));
process.env.AGENTIC_APP_SUPPORT_DIR = path.join(root, 'support');
process.env.ANDROID_HOME = path.join(root, 'sdk');
process.env.ANDROID_USER_HOME = path.join(root, 'android-user');
process.env.ANDROID_AVD_HOME = path.join(root, 'avd');
fs.mkdirSync(process.env.ANDROID_AVD_HOME, { recursive: true });
const { AndroidSetupService } = await import('../apps/server/src/services/AndroidSetupService.js');
const service = new AndroidSetupService();
console.log(`Isolated installation: ${root}`);
console.log(JSON.stringify(await service.status()));
service.start(true);
let previous = '';
for (;;) {
  await new Promise(resolve => setTimeout(resolve, 3000));
  const status = await service.status();
  if (status.message !== previous) { console.log(status.message); previous = status.message; }
  if (!status.running) {
    console.log(JSON.stringify(status));
    if (!status.ready || status.error) process.exitCode = 1;
    break;
  }
}
