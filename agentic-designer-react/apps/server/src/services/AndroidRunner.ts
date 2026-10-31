import fs from 'node:fs';
import { captureAndroidPreview } from './AndroidPreview.js';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { androidEnvironment, androidProcessEnv } from './AndroidEnvironment.js';
import { spawn } from 'node:child_process';
import { runProcess } from '../platform/ProcessRunner.js';
import { agenticSupportDirectory } from '../platform/Paths.js';
import type { AndroidRunRequest, AndroidRunResult, CodeDiagnostic } from '../bridge/protocol.js';

const AVD = 'AgenticDesigner_API_35';
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const digest = (text: string) => crypto.createHash('sha256').update(text).digest('hex');

export function validateAndroidRequest(request: AndroidRunRequest): void {
  if (!request || typeof request.projectId !== 'string' || !request.projectId || request.projectId.length > 256 ||
      typeof request.runId !== 'string' || request.runId.length > 100) throw new Error('מזהה פרויקט או הרצה אינו תקין.');
  if (!request.files || typeof request.files !== 'object' || Array.isArray(request.files)) throw new Error('חסרים קובצי Kotlin.');
  const entries = Object.entries(request.files);
  if (!entries.length || entries.length > 100) throw new Error('נדרשים 1–100 קובצי Kotlin.');
  let size = 0;
  for (const [file, source] of entries) {
    if (!/^app\/src\/main\/java\/(?:[A-Za-z_][A-Za-z0-9_]*\/)*[A-Za-z_][A-Za-z0-9_]*\.kt$/.test(file) ||
        file.endsWith('/AgenticLauncherActivity.kt') || typeof source !== 'string') throw new Error(`נתיב Kotlin אינו נתמך: ${file}`);
    size += Buffer.byteLength(source);
  }
  if (size > 2_000_000) throw new Error('קובצי הפרויקט גדולים מדי להרצה מקומית.');
  if (!Object.hasOwn(request.files, request.entryFile) || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(request.entryFunction)) throw new Error('מסך הכניסה אינו תקין.');
}

export function parseAndroidDiagnostics(output: string, root: string): CodeDiagnostic[] {
  return output.split('\n').flatMap(line => {
    const match = line.match(/^([ew]):\s+(?:file:\/\/)?(.+?\.kt):(\d+):(\d+)\s*(.*)$/);
    if (!match) return [];
    let file = match[2];
    try { file = decodeURIComponent(file); } catch { /* literal path */ }
    return [{ fileName: file.startsWith(root + '/') ? file.slice(root.length + 1) : file,
      line: Number(match[3]), column: Number(match[4]), severity: match[1] === 'e' ? 'error' : 'warning', message: match[5] }];
  });
}

/** Local, single-user development service. All build configuration is owned by the server.
 * Student Kotlin runs inside the Android emulator. This is not a multi-tenant build sandbox. */
export class AndroidRunner {
  private busy = false;
  constructor(private readonly process = runProcess, private readonly pause = delay) {}

  async run(request: AndroidRunRequest, progress: (message: string) => void = () => {}): Promise<AndroidRunResult> {
    validateAndroidRequest(request);
    if (this.busy) throw new Error('הרצת Android כבר מתבצעת. יש להמתין לסיומה.');
    this.busy = true;
    const sourceHash = digest(JSON.stringify([request.entryFile, request.entryFunction, Object.entries(request.files).sort()]));
    let phase: AndroidRunResult['phase'] = 'build';
    let output = '';
    let root = '';
    try {
      const { sdk, javaHome, gradle, adb, emulator } = androidEnvironment();
      for (const executable of [path.join(javaHome, 'bin/java'), gradle, adb, emulator]) {
        if (!fs.existsSync(executable)) throw new Error(`חסר כלי Android: ${executable}. ראו docs/android-emulator.he.md.`);
      }
      // Do not pass provider credentials to the build toolchain.
      const env = androidProcessEnv(javaHome, sdk);
      const exec = async (exe: string, args: string[], timeoutMs = 30_000) => {
        const result = await this.process(exe, args, { cwd: root || undefined, env, timeoutMs });
        output = (output + '\n' + result.output).slice(-80_000);
        return result;
      };
      const id = digest(request.projectId).slice(0, 16);
      root = agenticSupportDirectory('AndroidProjects', id);
      const packageName = `com.agenticdesigner.student.p${id}`;
      this.writeProject(root, sdk, packageName, request);
      progress('בונה את קוד Kotlin ל־APK. בבנייה הראשונה יורדות ספריות Android…');
      const build = await this.process(gradle, ['--no-daemon', '--console=plain', '--max-workers=4', ':app:assembleDebug'], {
        cwd: root, env, timeoutMs: 600_000,
        onChunk: chunk => { for (const line of chunk.split('\n')) if (line.startsWith('> Task')) progress(line); },
      });
      output = build.output.slice(-80_000);
      const diagnostics = parseAndroidDiagnostics(output, root).map(diagnostic =>
        diagnostic.fileName.endsWith('/AgenticLauncherActivity.kt') && diagnostic.message.includes(request.entryFunction) && diagnostic.message.includes('Unresolved reference')
          ? { ...diagnostic, fileName: request.entryFile, line: 1, column: 1,
              message: `לא נמצאה פונקציית המסך ${request.entryFunction}. כתוב בקובץ זה @Composable fun ${request.entryFunction}() { ... }. הקומפיילר דיווח: ${diagnostic.message}` }
          : diagnostic);
      if (build.status !== 0) return { success: false, phase, sourceHash, output, diagnostics,
        message: 'הבנייה נכשלה. תקן את שגיאות הקומפיילר ונסה שוב.' };
      const apkPath = path.join(root, 'app/build/outputs/apk/debug/app-debug.apk');
      if (!fs.existsSync(apkPath)) throw new Error('הבנייה הסתיימה ללא קובץ APK.');
      phase = 'emulator';
      progress('מאתר את אמולטור הלמידה…');
      const listed = await exec(adb, ['devices']);
      const serials = [...listed.output.matchAll(/^(emulator-\d+)\s+device$/gm)].map(m => m[1]);
      let serial: string | undefined;
      for (const candidate of serials) {
        const name = await exec(adb, ['-s', candidate, 'emu', 'avd', 'name']);
        if (name.status === 0 && name.output.split(/\r?\n/).includes(AVD)) { serial = candidate; break; }
      }
      if (!serial) {
        const avds = await exec(emulator, ['-list-avds']);
        if (!avds.output.split(/\r?\n/).includes(AVD)) throw new Error(`חסר אמולטור ${AVD}. ראו הוראות ההתקנה.`);
        progress('פותח אמולטור Android. ההפעלה הראשונה עשויה לקחת כמה דקות…');
        const logPath = path.join(root, 'emulator.log');
        const log = fs.openSync(logPath, 'a');
        const child = spawn(emulator, ['-avd', AVD, '-no-boot-anim', '-no-snapshot-save'], { env, detached: true, stdio: ['ignore', log, log] });
        fs.closeSync(log);
        let launchError = '';
        child.on('error', error => { launchError = error.message; });
        child.unref();
        const deadline = Date.now() + 180_000;
        while (!serial && Date.now() < deadline) {
          if (launchError || child.exitCode !== null) throw new Error(`פתיחת האמולטור נכשלה. ${launchError} ראו ${logPath}`);
          await this.pause(1500);
          const devices = await exec(adb, ['devices']);
          for (const match of devices.output.matchAll(/^(emulator-\d+)\s+device$/gm)) {
            const name = await exec(adb, ['-s', match[1], 'emu', 'avd', 'name']);
            if (name.output.split(/\r?\n/).includes(AVD)) { serial = match[1]; break; }
          }
        }
      }
      if (!serial) throw new Error('האמולטור לא התחבר בזמן. נסה שוב לאחר שסיים לעלות.');
      let booted = false;
      const deadline = Date.now() + 180_000;
      while (Date.now() < deadline) {
        const boot = await exec(adb, ['-s', serial, 'shell', 'getprop', 'sys.boot_completed']);
        if (boot.status === 0 && boot.output.trim() === '1') { booted = true; break; }
        await this.pause(1500);
      }
      if (!booted) throw new Error('Android עדיין לא סיים לעלות. נסה שוב בעוד רגע.');
      phase = 'install';
      progress('מתקין את האפליקציה באמולטור…');
      const install = await exec(adb, ['-s', serial, 'install', '-r', apkPath], 120_000);
      if (install.status !== 0 || !/Success/.test(install.output)) throw new Error(`התקנת APK נכשלה: ${install.output}`);
      phase = 'launch';
      progress('מפעיל את המסך ובודק שהאפליקציה נשארת פעילה…');
      await exec(adb, ['-s', serial, 'shell', 'am', 'force-stop', packageName]);
      const launch = await exec(adb, ['-s', serial, 'shell', 'am', 'start', '-W', '-n', `${packageName}/com.agenticdesigner.runtime.AgenticLauncherActivity`]);
      if (launch.status !== 0 || /Error:|Exception/.test(launch.output)) throw new Error(`ההפעלה נכשלה: ${launch.output}`);
      await this.pause(2500);
      const pid = await exec(adb, ['-s', serial, 'shell', 'pidof', packageName]);
      if (pid.status !== 0 || !/^\d+(?:\s+\d+)*$/.test(pid.output.trim())) {
        const crash = await exec(adb, ['-s', serial, 'logcat', '-b', 'crash', '-d', '-t', '100']);
        throw new Error(`האפליקציה נסגרה לאחר ההפעלה.\n${crash.output}`);
      }
      let previewImage: string | undefined, previewError: string | undefined;
      if (request.capturePreview === true) {
        progress('מצלם את המסך ל־Preview בדפדפן…');
        try {
          const foreground = await exec(adb, ['-s', serial, 'shell', 'dumpsys', 'activity', 'activities']);
          if (!foreground.output.split('\n').some(line => /(?:mResumedActivity|topResumedActivity)/.test(line) && line.includes(`${packageName}/`))) {
            throw new Error('אפליקציית התלמיד אינה בחזית האמולטור. הפעל שוב כדי לצלם את המסך הנכון.');
          }
          previewImage = await captureAndroidPreview(adb, serial, env);
        } catch (error) { previewError = (error as Error).message; }
      }
      return { success: true, phase, sourceHash, output, diagnostics, serial, packageName, apkPath, previewImage, previewError,
        message: 'האפליקציה נבנתה והופעלה באמולטור Android. מוצגים רק הרכיבים שכתבת בקוד; פריסה ריקה תציג מסך ריק.' };
    } catch (error) {
      return { success: false, phase, sourceHash, output, diagnostics: parseAndroidDiagnostics(output, root), message: (error as Error).message };
    } finally { this.busy = false; }
  }

  private writeProject(root: string, sdk: string, packageName: string, request: AndroidRunRequest): void {
    const write = (file: string, content: string) => { const target = path.join(root, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, content); };
    // Only this service owns this hashed workspace. Remove deleted student sources, retain build caches.
    fs.rmSync(path.join(root, 'app/src/main/java'), { recursive: true, force: true });
    write('settings.gradle.kts', `pluginManagement { repositories { google(); mavenCentral(); gradlePluginPortal() } }
dependencyResolutionManagement { repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS); repositories { google(); mavenCentral() } }
rootProject.name = "StudentApp"
include(":app")\n`);
    write('build.gradle.kts', `plugins {
 id("com.android.application") version "8.9.2" apply false
 id("org.jetbrains.kotlin.android") version "2.1.20" apply false
 id("org.jetbrains.kotlin.plugin.compose") version "2.1.20" apply false
}\n`);
    write('gradle.properties', 'android.useAndroidX=true\norg.gradle.jvmargs=-Xmx2g -Dfile.encoding=UTF-8\nkotlin.code.style=official\n');
    write('local.properties', `sdk.dir=${sdk.replaceAll('\\', '\\\\').replaceAll(':', '\\:')}\n`);
    write('app/build.gradle.kts', `plugins { id("com.android.application"); id("org.jetbrains.kotlin.android"); id("org.jetbrains.kotlin.plugin.compose") }
android {
 namespace = "com.agenticdesigner.runtime"
 compileSdk = 35
 defaultConfig { applicationId = "${packageName}"; minSdk = 26; targetSdk = 35; versionCode = 1; versionName = "1.0" }
 buildFeatures { compose = true }
 compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
 kotlinOptions { jvmTarget = "17" }
}
dependencies {
 implementation(platform("androidx.compose:compose-bom:2025.04.01"))
 implementation("androidx.activity:activity-compose:1.10.1")
 implementation("androidx.compose.material3:material3")
 implementation("androidx.compose.material:material-icons-extended")
 implementation("androidx.compose.ui:ui-tooling-preview")
 debugImplementation("androidx.compose.ui:ui-tooling")
 implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")
 implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")
 implementation("androidx.navigation:navigation-compose:2.8.9")
}\n`);
    write('app/src/main/AndroidManifest.xml', `<manifest xmlns:android="http://schemas.android.com/apk/res/android"><uses-permission android:name="android.permission.INTERNET"/><application android:label="Student App" android:theme="@android:style/Theme.Material.Light.NoActionBar" android:supportsRtl="true"><activity android:name="com.agenticdesigner.runtime.AgenticLauncherActivity" android:exported="true"><intent-filter><action android:name="android.intent.action.MAIN"/><category android:name="android.intent.category.LAUNCHER"/></intent-filter></activity></application></manifest>`);
    for (const [file, source] of Object.entries(request.files)) write(file, source);
    const source = request.files[request.entryFile];
    const pkg = source.match(/^\s*package\s+([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s*;?\s*$/m)?.[1];
    if (!pkg) throw new Error('נדרשת הצהרת package תקינה בקובץ המסך.');
    write('app/src/main/java/com/agenticdesigner/runtime/AgenticLauncherActivity.kt', `package com.agenticdesigner.runtime
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.material3.MaterialTheme
import ${pkg}.${request.entryFunction}
class AgenticLauncherActivity : ComponentActivity() {
 override fun onCreate(savedInstanceState: Bundle?) {
  super.onCreate(savedInstanceState)
  setContent { MaterialTheme { ${request.entryFunction}() } }
 }
}\n`);
  }
}
