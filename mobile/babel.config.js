module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      ['babel-preset-expo', { jsxImportSource: 'nativewind' }],
    ],
    plugins: [
      // worklets-core must run before Reanimated's Babel transform.
      'react-native-worklets-core/plugin',
      // MUST remain last — required by react-native-reanimated.
      'react-native-reanimated/plugin',
    ],
  };
};
