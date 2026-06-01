#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');
const androidRoot = path.join(projectRoot, 'android');
const args = new Set(process.argv.slice(2));
const targetArg = process.argv.find(arg => arg.startsWith('--target='));
const target = targetArg ? targetArg.split('=')[1] : args.has('--aab') ? 'aab' : 'apk';
const shouldBuild = args.has('--build');

const REQUIRED_PUBLIC_ENV = [
  'EXPO_PUBLIC_API_URL',
  'EXPO_PUBLIC_WS_URL',
];

function print(message = '') {
  process.stdout.write(`${message}\n`);
}

function fail(message, details = []) {
  print(`\n[release-check] ${message}`);
  details.forEach(detail => print(`  - ${detail}`));
  process.exitCode = 1;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([\w.-]+)\s*=\s*(.*)$/);
    if (!match) continue;
    const key = match[1];
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] == null) process.env[key] = value;
  }
}

function hasExecutable(filePath) {
  return filePath && fs.existsSync(filePath) && fs.statSync(filePath).isFile();
}

function normalizeWindowsPath(rawPath) {
  return rawPath ? rawPath.replace(/\\/g, path.sep) : rawPath;
}

function parseLocalPropertiesSdkDir() {
  const localProperties = path.join(androidRoot, 'local.properties');
  if (!fs.existsSync(localProperties)) return null;
  const content = fs.readFileSync(localProperties, 'utf8');
  const line = content.split(/\r?\n/).find(item => item.trim().startsWith('sdk.dir='));
  if (!line) return null;
  const value = line.slice(line.indexOf('=') + 1).trim();
  return normalizeWindowsPath(value.replace(/\\\\/g, '\\'));
}

function findJavaHome() {
  const candidates = [
    process.env.JAVA_HOME,
    'C:\\Program Files\\Android\\Android Studio\\jbr',
    'C:\\Program Files\\Java\\jdk-17',
    'C:\\Program Files\\Java\\jdk-21',
  ].filter(Boolean);

  for (const candidate of candidates) {
    const javaPath = path.join(candidate, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
    if (hasExecutable(javaPath)) return candidate;
  }

  const command = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(command, ['java'], { encoding: 'utf8' });
  const javaPath = result.stdout?.split(/\r?\n/).find(Boolean);
  if (javaPath && hasExecutable(javaPath)) {
    return path.resolve(javaPath, '..', '..');
  }
  return null;
}

function findAndroidSdk() {
  const candidates = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    parseLocalPropertiesSdkDir(),
    path.join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk'),
    'C:\\Android\\Sdk',
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (
      fs.existsSync(candidate) &&
      fs.existsSync(path.join(candidate, 'platforms')) &&
      fs.existsSync(path.join(candidate, 'build-tools'))
    ) {
      return candidate;
    }
  }
  return null;
}

function validateUrl(name, value, protocols) {
  if (!value) return `${name} is missing`;
  try {
    const parsed = new URL(value);
    if (!protocols.includes(parsed.protocol)) {
      return `${name} must use ${protocols.join(' or ')}`;
    }
  } catch {
    return `${name} is not a valid URL`;
  }
  return null;
}

function validateEnv() {
  const errors = [];
  for (const key of REQUIRED_PUBLIC_ENV) {
    if (!process.env[key] || process.env[key].includes('your_')) {
      errors.push(`${key} is missing or still set to a placeholder`);
    }
  }

  const apiError = validateUrl('EXPO_PUBLIC_API_URL', process.env.EXPO_PUBLIC_API_URL, ['https:', 'http:']);
  const wsError = validateUrl('EXPO_PUBLIC_WS_URL', process.env.EXPO_PUBLIC_WS_URL, ['wss:', 'ws:']);
  if (apiError) errors.push(apiError);
  if (wsError) errors.push(wsError);

  if (!process.env.EXPO_PUBLIC_GEMINI_API_KEY && !process.env.GEMINI_API_KEY) {
    errors.push('EXPO_PUBLIC_GEMINI_API_KEY or GEMINI_API_KEY is missing');
  }

  if (process.env.GEMINI_API_KEY && !process.env.EXPO_PUBLIC_GEMINI_API_KEY) {
    print('[release-check] GEMINI_API_KEY is present; Expo runtime expects EXPO_PUBLIC_GEMINI_API_KEY for mobile bundling.');
  }

  return errors;
}

function validateConfig() {
  const errors = [];
  const appConfig = readJson(path.join(projectRoot, 'app.json'));
  const easConfig = readJson(path.join(projectRoot, 'eas.json'));
  const babelConfig = require(path.join(projectRoot, 'babel.config.js'))({ cache: () => {} });

  const permissions = appConfig.expo?.android?.permissions || [];
  if (permissions.length !== new Set(permissions).size) {
    errors.push('app.json android.permissions contains duplicate entries');
  }

  const plugins = appConfig.expo?.plugins || [];
  const pluginNames = plugins.map(plugin => Array.isArray(plugin) ? plugin[0] : plugin);
  const releaseFixIndex = pluginNames.indexOf('./plugins/withAndroidReleaseFixes.js');
  if (releaseFixIndex !== pluginNames.length - 1) {
    errors.push('withAndroidReleaseFixes.js must remain the final Expo plugin');
  }

  const babelPlugins = babelConfig.plugins || [];
  if (babelPlugins[babelPlugins.length - 1] !== 'react-native-reanimated/plugin') {
    errors.push('react-native-reanimated/plugin must be the final Babel plugin');
  }
  const workletsIndex = babelPlugins.indexOf('react-native-worklets-core/plugin');
  const reanimatedIndex = babelPlugins.indexOf('react-native-reanimated/plugin');
  if (workletsIndex === -1 || reanimatedIndex === -1 || workletsIndex > reanimatedIndex) {
    errors.push('react-native-worklets-core/plugin must run before react-native-reanimated/plugin');
  }

  if (easConfig.build?.production?.android?.buildType !== 'apk') {
    errors.push('eas.json production profile must build an APK');
  }
  if (easConfig.build?.['production-aab']?.android?.buildType !== 'app-bundle') {
    errors.push('eas.json production-aab profile must build an app-bundle');
  }

  return errors;
}

function validateTooling() {
  const errors = [];
  const javaHome = findJavaHome();
  const androidSdk = findAndroidSdk();

  if (!javaHome) {
    errors.push('JAVA_HOME is missing and no usable java executable was found');
  }
  if (!androidSdk) {
    errors.push('Android SDK was not found via ANDROID_HOME, ANDROID_SDK_ROOT, android/local.properties, or the default AppData path');
  }

  return { errors, javaHome, androidSdk };
}

function printSetup(tooling) {
  if (tooling.javaHome && tooling.androidSdk) return;
  print('\nAndroid release setup:');
  if (!tooling.javaHome) {
    print('  1. Install Android Studio with the bundled JDK, or install JDK 17.');
    print("  2. Set JAVA_HOME, for example: $env:JAVA_HOME='C:\\Program Files\\Android\\Android Studio\\jbr'");
  }
  if (!tooling.androidSdk) {
    print('  3. Install Android SDK Platform + Build Tools from Android Studio SDK Manager.');
    print("  4. Set ANDROID_HOME, for example: $env:ANDROID_HOME='C:\\Users\\PC\\AppData\\Local\\Android\\Sdk'");
    print("  5. Or create mobile/android/local.properties with: sdk.dir=C:\\\\Users\\\\PC\\\\AppData\\\\Local\\\\Android\\\\Sdk");
  }
}

function runGradle(javaHome, androidSdk) {
  const gradleTask = target === 'aab' ? 'bundleRelease' : 'assembleRelease';
  const command = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
  const env = {
    ...process.env,
    JAVA_HOME: javaHome,
    ANDROID_HOME: androidSdk,
    ANDROID_SDK_ROOT: androidSdk,
    PATH: `${path.join(javaHome, 'bin')}${path.delimiter}${process.env.PATH || ''}`,
  };

  print(`\n[release-check] Running ${gradleTask}...`);
  const result = spawnSync(command, [gradleTask], {
    cwd: androidRoot,
    env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  process.exitCode = result.status || 0;
}

loadDotEnv(path.resolve(projectRoot, '..', '.env'));
loadDotEnv(path.join(projectRoot, '.env'));

print(`[release-check] Target: ${target.toUpperCase()}`);
const envErrors = validateEnv();
const configErrors = validateConfig();
const tooling = validateTooling();
const errors = [...envErrors, ...configErrors, ...tooling.errors];

if (errors.length > 0) {
  fail('Release preflight failed.', errors);
  printSetup(tooling);
  process.exit();
}

print('[release-check] Environment, Android tooling, and release config look ready.');

if (shouldBuild) {
  runGradle(tooling.javaHome, tooling.androidSdk);
}
