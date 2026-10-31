import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { agenticSupportDirectory } from '../platform/Paths.js';
export const ANDROID_AVD = 'AgenticDesigner_API_35';
export function androidEnvironment() {
  const tools = agenticSupportDirectory('AndroidTools');
  const sdk = process.env.ANDROID_HOME || path.join(os.homedir(), 'Library/Android/sdk');
  const managedJava = path.join(tools, 'jdk-17', 'Contents/Home');
  const javaHome = process.env.AGENTIC_ANDROID_JAVA_HOME ||
    (fs.existsSync(path.join(managedJava, 'bin/java')) ? managedJava : '/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home');
  return { tools, sdk, javaHome,
    gradle: process.env.AGENTIC_ANDROID_GRADLE || path.join(tools, 'gradle-8.11.1/bin/gradle'),
    adb: path.join(sdk, 'platform-tools/adb'), emulator: path.join(sdk, 'emulator/emulator'),
    sdkmanager: path.join(sdk, 'cmdline-tools/16.0/bin/sdkmanager'),
    avdmanager: path.join(sdk, 'cmdline-tools/16.0/bin/avdmanager'),
  };
}
export function androidProcessEnv(javaHome: string, sdk: string): NodeJS.ProcessEnv {
  return { HOME: os.homedir(), PATH: `${javaHome}/bin:/opt/homebrew/bin:/usr/bin:/bin`, JAVA_HOME: javaHome,
    ANDROID_HOME: sdk, ANDROID_SDK_ROOT: sdk, TMPDIR: os.tmpdir(), LANG: 'en_US.UTF-8',
    ...(process.env.ANDROID_AVD_HOME ? { ANDROID_AVD_HOME: process.env.ANDROID_AVD_HOME } : {}),
    ...(process.env.ANDROID_USER_HOME ? { ANDROID_USER_HOME: process.env.ANDROID_USER_HOME } : {}) };
}
