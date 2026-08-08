const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

const config = getDefaultConfig(__dirname);

// `mixpanel-react-native` is an optional native dependency, installed only when the founder enables the
// live analytics path (DESIGN.md Appendix B). Until then, resolve it to an empty module so a token-less
// build bundles — the code that touches it (createMixpanelBackend) only runs once a token is set.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "mixpanel-react-native") {
    try {
      return context.resolveRequest(context, moduleName, platform);
    } catch {
      return { type: "empty" };
    }
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = withNativeWind(config, { input: "./global.css" });
