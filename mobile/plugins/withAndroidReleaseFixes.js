const { withDangerousMod, withAppBuildGradle } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const withAndroidReleaseFixes = (config) => {
  // 1. Inject ProGuard rules
  config = withDangerousMod(config, [
    'android',
    async (config) => {
      const proguardPath = path.join(config.modRequest.platformProjectRoot, 'app', 'proguard-rules.pro');
      const customRules = `
# Mandatory Proguard Rules for Release Stability
-keep class com.swmansion.reanimated.** { *; }
-keep class com.swmansion.gesturehandler.** { *; }
-keep class com.worklets.** { *; }
-keep class expo.modules.** { *; }
-keep class com.facebook.hermes.reactexecutor.** { *; }
-keep class com.facebook.react.** { *; }
-keep class kotlin.Metadata { *; }
-keep class kotlin.reflect.** { *; }
`;
      if (fs.existsSync(proguardPath)) {
        let content = fs.readFileSync(proguardPath, 'utf8');
        if (!content.includes('Mandatory Proguard Rules')) {
          fs.writeFileSync(proguardPath, content + '\n' + customRules);
        }
      } else {
        fs.writeFileSync(proguardPath, customRules);
      }

      const gradlePropertiesPath = path.join(config.modRequest.platformProjectRoot, 'gradle.properties');
      if (fs.existsSync(gradlePropertiesPath)) {
        let content = fs.readFileSync(gradlePropertiesPath, 'utf8');
        const stableJvmArgs = 'org.gradle.jvmargs=-Xmx4096m -XX:MaxMetaspaceSize=1024m';
        if (content.includes('org.gradle.jvmargs=')) {
          content = content.replace(/^org\.gradle\.jvmargs=.*$/m, stableJvmArgs);
        } else {
          content = `${stableJvmArgs}\n${content}`;
        }
        fs.writeFileSync(gradlePropertiesPath, content);
      }

      return config;
    },
  ]);

  // 2. Disable minifyEnabled and shrinkResources
  config = withAppBuildGradle(config, (config) => {
    let buildGradle = config.modResults.contents;
    
    // In React Native 0.74, these properties are in the android.buildTypes.release block
    buildGradle = buildGradle.replace(/minifyEnabled\s+true/g, 'minifyEnabled false');
    buildGradle = buildGradle.replace(/shrinkResources\s+true/g, 'shrinkResources false');
    
    // Also disable the global def if it exists
    buildGradle = buildGradle.replace(/def enableProguardInReleaseBuilds = true/, 'def enableProguardInReleaseBuilds = false');

    config.modResults.contents = buildGradle;
    return config;
  });

  return config;
};

module.exports = withAndroidReleaseFixes;
