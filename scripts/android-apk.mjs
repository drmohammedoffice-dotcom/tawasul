import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const androidDir = path.join(root, 'frontend', 'android');
const outDir = path.join(root, 'frontend', 'release');

const javaCandidates = [
  process.env.JAVA_HOME,
  'C:\\Program Files\\Microsoft\\jdk-21.0.12.101-hotspot',
  'C:\\Program Files\\Android\\Android Studio\\jbr'
].filter(Boolean);

let javaHome = javaCandidates.find((p) => fs.existsSync(path.join(p, 'bin', 'java.exe')));
if (!javaHome) {
  console.error('[android-apk] JAVA_HOME / JDK 21 not found. Install Microsoft OpenJDK 21.');
  process.exit(1);
}

const androidHome =
  process.env.ANDROID_HOME ||
  process.env.ANDROID_SDK_ROOT ||
  path.join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk');

if (!fs.existsSync(androidHome)) {
  console.error('[android-apk] Android SDK not found at', androidHome);
  process.exit(1);
}

const env = {
  ...process.env,
  JAVA_HOME: javaHome,
  ANDROID_HOME: androidHome,
  ANDROID_SDK_ROOT: androidHome,
  Path: `${path.join(javaHome, 'bin')};${path.join(androidHome, 'platform-tools')};${process.env.Path || process.env.PATH}`
};

console.log('[android-apk] JAVA_HOME=', javaHome);
console.log('[android-apk] ANDROID_HOME=', androidHome);

const gradlew = path.join(androidDir, 'gradlew.bat');
const result = spawnSync(gradlew, ['assembleDebug', 'assembleRelease', '--no-daemon'], {
  cwd: androidDir,
  env,
  stdio: 'inherit',
  shell: true
});

if (result.status !== 0) {
  process.exit(result.status || 1);
}

fs.mkdirSync(outDir, { recursive: true });
const debugSrc = path.join(androidDir, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
const releaseSrc = path.join(
  androidDir,
  'app',
  'build',
  'outputs',
  'apk',
  'release',
  'app-release-unsigned.apk'
);

fs.copyFileSync(debugSrc, path.join(outDir, 'SecureChat-debug.apk'));
if (fs.existsSync(releaseSrc)) {
  fs.copyFileSync(releaseSrc, path.join(outDir, 'SecureChat-release-unsigned.apk'));
}

console.log('[android-apk] Installable APK:');
console.log(' ', path.join(outDir, 'SecureChat-debug.apk'));
