import type { Backend, Props } from "./backend";

/**
 * The subset of the `mixpanel-react-native` SDK we call. Declared locally and loaded with a dynamic
 * require so a token-less build (dev / sim / tests) never pulls the native module into the bundle.
 * To enable the live path, install the SDK and set the token — see DESIGN.md Appendix B.
 */
type MixpanelPeople = { set(props: Props): void };
type MixpanelInstance = {
  init(): void;
  track(event: string, props?: Props): void;
  identify(userId: string): void;
  getPeople(): MixpanelPeople;
  reset(): void;
};
type MixpanelCtor = new (token: string, trackAutomaticEvents: boolean) => MixpanelInstance;

function loadMixpanel(): { Mixpanel: MixpanelCtor } {
  // Indirection through a variable keeps Metro from statically resolving (and bundling) the module.
  const moduleName = "mixpanel-react-native";
  return require(moduleName) as { Mixpanel: MixpanelCtor };
}

/** Builds the live backend. Called only when a token is present, so `loadMixpanel` never runs otherwise. */
export function createMixpanelBackend(token: string): Backend {
  const { Mixpanel } = loadMixpanel();
  const mp = new Mixpanel(token, false);
  mp.init();
  return {
    track: (event, props) => mp.track(event, props),
    identify: (userId) => mp.identify(userId),
    setPeople: (props) => mp.getPeople().set(props),
    reset: () => mp.reset(),
  };
}
