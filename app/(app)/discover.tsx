import React from "react";
import { View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Backdrop } from "../../components/recime/Backdrop";
import { SwipeDeck } from "../../components/swipe/SwipeDeck";
import { useRealDeck } from "../../components/swipe/useRealDeck";
import { usePreferences, useUpdatePreferences } from "../../lib/api/hooks";
import { apiToClient, clientToApi } from "../../lib/api/preferences-map";
import type { Preferences } from "../../components/swipe/mock";

/**
 * Discover = the recipe swipe deck (WI-3). The deck is fed by the real ranked-deck / swipe
 * endpoints; the gear opens the settings modal seeded from — and saved back to — the real
 * preference model (WI-4). Preferences also supply the "owned equipment" set the accent badge uses.
 */
export default function Discover() {
  const prefs = usePreferences();
  const updatePrefs = useUpdatePreferences();
  const controller = useRealDeck({ ownedEquipment: prefs.data?.owned_equipment ?? [] });
  const settingsInitial = prefs.data ? apiToClient(prefs.data) : undefined;
  const onSaveSettings = React.useCallback((p: Preferences) => updatePrefs.mutate(clientToApi(p)), [updatePrefs]);

  return (
    <SafeAreaView className="flex-1 bg-cream" edges={["top"]}>
      <Backdrop />
      <View className="flex-1 justify-center">
        <SwipeDeck controller={controller} settingsInitial={settingsInitial} onSaveSettings={onSaveSettings} />
      </View>
    </SafeAreaView>
  );
}
