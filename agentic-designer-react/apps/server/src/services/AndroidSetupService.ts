import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { Readable, Transform } from 'node:stream';
import { runProcess } from '../platform/ProcessRunner.js';
import { androidEnvironment, androidProcessEnv, ANDROID_AVD } from './AndroidEnvironment.js';
import type { AndroidSetupStatus } from '../bridge/protocol.js';

// Verified against Google's repository metadata and Gradle's distribution checksum.
const TOOLS_URL = 'https://dl.google.com/android/repository/commandlinetools-mac-12266719_latest.zip';
const TOOLS_SHA1 = 'b2fb3e403104bf342be7abf0631c23e30559d222';
const SDK_PACKAGES = ['platform-tools', 'platforms;android-35', 'build-tools;35.0.0', 'emulator', 'system-images;android-35;google_apis;arm64-v8a'];

/** Install tasks live on the local server, so closing/reloading the wizard does not interrupt them. */
export class AndroidSetupService {
  private running = false;
  private message = '';
  private error: string | null = null;
  constructor(private readonly platform: string = os.platform(), private readonly arch: string = os.arch()) {}

  async status(): Promise<AndroidSetupStatus> {
    const e = androidEnvironment();
    const supported = this.platform === 'darwin' && this.arch === 'arm64';
    const executable = (file: string) => { try { fs.accessSync(file, fs.constants.X_OK); return true; } catch { return false; } };
    const probe = async (file: string, args: string[], pattern?: RegExp) => {
      if (!supported || !executable(file)) return false;
      try {
        const result = await runProcess(file, args, { env: androidProcessEnv(e.javaHome, e.sdk), timeoutMs: 15_000 });
        return result.status === 0 && (!pattern || pattern.test(result.output));
      } catch { return false; }
    };
    const [java, adb, avd] = await Promise.all([
      probe(path.join(e.javaHome, 'bin/java'), ['-version'], /version "17\./),
      probe(e.adb, ['version'], /Android Debug Bridge/),
      probe(e.emulator, ['-list-avds'], new RegExp(`^${ANDROID_AVD}$`, 'm')),
    ]);
    const components = [
      { id: 'java', label: 'Java 17 — מנוע הבנייה', ready: java },
      { id: 'gradle', label: 'Gradle — בניית האפליקציה', ready: executable(e.gradle) },
      { id: 'tools', label: 'כלי התקנת Android', ready: executable(e.sdkmanager) && executable(e.avdmanager) },
      { id: 'sdk', label: 'Android SDK 35 וכלי חיבור', ready: adb && fs.existsSync(path.join(e.sdk, 'platforms/android-35/android.jar')) && executable(path.join(e.sdk, 'build-tools/35.0.0/aapt2')) },
      { id: 'emulator', label: 'האמולטור ותמונת Android', ready: executable(e.emulator) && fs.existsSync(path.join(e.sdk, 'system-images/android-35/google_apis/arm64-v8a/system.img')) },
      { id: 'avd', label: 'מכשיר הלמידה הווירטואלי', ready: avd },
    ];
    return { supported, components, ready: supported && components.every(c => c.ready), running: this.running,
      message: supported ? this.message : 'ההתקנה האוטומטית זמינה כרגע ב־Mac עם מעבד Apple Silicon. מחשב זה אינו נתמך באשף.', error: this.error };
  }

  start(acceptLicenses: boolean): { started: boolean } {
    if (this.platform !== 'darwin' || this.arch !== 'arm64') throw new Error('התקנה אוטומטית נתמכת כרגע ב־Mac עם Apple Silicon בלבד.');
    if (acceptLicenses !== true) throw new Error('יש לאשר את תנאי הרישיון לפני התקנת הכלים.');
    if (this.running) return { started: false };
    this.running = true; this.error = null; this.message = 'בודק את סביבת ההתקנה…';
    void this.install().catch(error => { this.error = (error as Error).message; this.message = 'ההתקנה לא הושלמה. אפשר לתקן ולנסות שוב.'; })
      .finally(() => { this.running = false; });
    return { started: true };
  }

  private async command(file: string, args: string[], input?: string): Promise<string> {
    const e = androidEnvironment();
    return new Promise((resolve, reject) => {
      const child = spawn(file, args, { env: androidProcessEnv(e.javaHome, e.sdk), stdio: ['pipe', 'pipe', 'pipe'] });
      let output = '', timedOut = false;
      const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, 30 * 60_000);
      const collect = (data: Buffer) => { output = (output + data.toString()).slice(-12_000); };
      child.stdout.on('data', collect); child.stderr.on('data', collect);
      child.stdin.on('error', () => {}); // Some tools exit before consuming all license answers.
      child.stdin.end(input ?? '');
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('close', code => {
        clearTimeout(timer);
        if (code === 0 && !timedOut) resolve(output);
        else reject(new Error(`${timedOut ? 'זמן ההתקנה חרג מהמותר.' : 'כלי ההתקנה נכשל.'}\n${output}`));
      });
    });
  }

  private async download(url: string, file: string, expected: string, algorithm = 'sha256'): Promise<void> {
    if (!new RegExp(`^[a-f0-9]{${algorithm === 'sha1' ? 40 : 64}}$`, 'i').test(expected)) throw new Error('חתימת ההורדה אינה תקינה.');
    const response = await fetch(url, { signal: AbortSignal.timeout(20 * 60_000) });
    if (!response.ok || !response.body) throw new Error(`ההורדה נכשלה (${response.status}). בדוק את חיבור האינטרנט ונסה שוב.`);
    const hash = crypto.createHash(algorithm);
    let bytes = 0, last = 0;
    const label = this.message;
    const meter = new Transform({ transform: (chunk, _encoding, callback) => {
      hash.update(chunk); bytes += chunk.length;
      if (Date.now() - last > 1000) { last = Date.now(); this.message = `${label} (${Math.round(bytes / 1048576)} MB)`; }
      callback(null, chunk);
    } });
    await pipeline(Readable.fromWeb(response.body as never), meter, fs.createWriteStream(file));
    if (hash.digest('hex').toLowerCase() !== expected.toLowerCase()) { fs.rmSync(file, { force: true }); throw new Error('בדיקת תקינות ההורדה נכשלה. הקובץ לא יותקן.'); }
  }

  private async install(): Promise<void> {
    const initial = await this.status();
    if (initial.ready) { this.message = 'סביבת Android כבר מוכנה להרצה.'; return; }
    let e = androidEnvironment();
    fs.mkdirSync(e.tools, { recursive: true });
    const free = fs.statfsSync(e.tools);
    if (free.bavail * free.bsize < 12 * 1024 ** 3) throw new Error('נדרשים לפחות 12 GB פנויים להכנת הסביבה.');
    const staging = fs.mkdtempSync(path.join(e.tools, '.setup-'));
    const missing = (id: string) => !initial.components.find(c => c.id === id)?.ready;
    try {
      if (missing('java')) {
        if (process.env.AGENTIC_ANDROID_JAVA_HOME) throw new Error('נתיב Java שהוגדר לשרת אינו תקין. תקן AGENTIC_ANDROID_JAVA_HOME ונסה שוב.');
        this.message = 'מוריד Java 17 למחשב…';
        const response = await fetch('https://api.adoptium.net/v3/assets/latest/17/hotspot?architecture=aarch64&image_type=jdk&os=mac&vendor=eclipse', { signal: AbortSignal.timeout(30_000) });
        if (!response.ok) throw new Error('לא ניתן לקבל את פרטי הורדת Java.');
        const assets = await response.json() as Array<{ binary: { package: { link: string; checksum: string } } }>;
        const pkg = assets[0]?.binary?.package;
        if (!pkg || !pkg.link.startsWith('https://github.com/adoptium/temurin17-binaries/releases/download/')) throw new Error('מקור הורדת Java אינו תקין.');
        const archive = path.join(staging, 'java.tar.gz');
        await this.download(pkg.link, archive, pkg.checksum);
        const extracted = path.join(staging, 'java'); fs.mkdirSync(extracted);
        await this.command('/usr/bin/tar', ['-xzf', archive, '-C', extracted]);
        const jdk = fs.readdirSync(extracted).find(name => fs.existsSync(path.join(extracted, name, 'Contents/Home/bin/java')));
        if (!jdk) throw new Error('ארכיון Java אינו מכיל סביבת Java תקינה.');
        const target = path.join(e.tools, 'jdk-17');
        if (fs.existsSync(target)) throw new Error(`קיימת התקנת Java לא תקינה: ${target}. יש לבדוק אותה לפני ניסיון נוסף.`);
        fs.renameSync(path.join(extracted, jdk), target); e = androidEnvironment();
      }
      if (missing('gradle')) {
        if (process.env.AGENTIC_ANDROID_GRADLE) throw new Error('נתיב Gradle שהוגדר לשרת אינו תקין. תקן AGENTIC_ANDROID_GRADLE.');
        this.message = 'מוריד את כלי בניית האפליקציה…';
        const checksum = await fetch('https://services.gradle.org/distributions/gradle-8.11.1-bin.zip.sha256', { signal: AbortSignal.timeout(30_000) });
        if (!checksum.ok) throw new Error('לא ניתן לאמת את הורדת Gradle.');
        const archive = path.join(staging, 'gradle.zip');
        await this.download('https://services.gradle.org/distributions/gradle-8.11.1-bin.zip', archive, (await checksum.text()).trim());
        await this.command('/usr/bin/unzip', ['-q', archive, '-d', staging]);
        const target = path.join(e.tools, 'gradle-8.11.1');
        if (fs.existsSync(target)) throw new Error(`קיימת התקנת Gradle לא תקינה: ${target}. יש לבדוק אותה לפני ניסיון נוסף.`);
        fs.renameSync(path.join(staging, 'gradle-8.11.1'), target);
      }
      if (missing('tools')) {
        this.message = 'מוריד את כלי התקנת Android…';
        const archive = path.join(staging, 'tools.zip');
        await this.download(TOOLS_URL, archive, TOOLS_SHA1, 'sha1');
        await this.command('/usr/bin/unzip', ['-q', archive, '-d', staging]);
        const target = path.join(e.sdk, 'cmdline-tools/16.0'); fs.mkdirSync(path.dirname(target), { recursive: true });
        if (fs.existsSync(target)) throw new Error(`קיימת התקנת כלים לא תקינה: ${target}. יש לבדוק אותה לפני ניסיון נוסף.`);
        fs.renameSync(path.join(staging, 'cmdline-tools'), target);
      }
      const packages = [...(missing('sdk') ? SDK_PACKAGES.slice(0, 3) : []), ...(missing('emulator') ? SDK_PACKAGES.slice(3) : [])];
      if (packages.length) {
        this.message = 'מתקין אמולטור ותמונת Android. שלב זה מוריד כמה GB ועשוי לקחת מספר דקות…';
        await this.command(e.sdkmanager, [`--sdk_root=${e.sdk}`, ...packages], 'y\n'.repeat(200));
      }
      if (missing('avd')) {
        this.message = 'יוצר את מכשיר הלמידה הווירטואלי…';
        await this.command(e.avdmanager, ['create', 'avd', '-n', ANDROID_AVD, '-k', SDK_PACKAGES[4], '-d', 'pixel_7'], 'no\n');
      }
      this.message = 'מאמת את סביבת Android…';
      const final = await this.status();
      if (!final.ready) throw new Error(`ההתקנה הסתיימה אך עדיין חסרים רכיבים: ${final.components.filter(c => !c.ready).map(c => c.label).join(', ')}`);
      this.message = 'סביבת Android מוכנה. אפשר לחזור לקוד וללחוץ על הרץ ב־Android.';
    } finally { fs.rmSync(staging, { recursive: true, force: true }); }
  }
}
