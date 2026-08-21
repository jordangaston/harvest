import React from "react";
import { View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Backdrop } from "../../components/recime/Backdrop";
import { OnboardingScreen } from "../../components/recime/OnboardingScreen";
import { OnboardingValueCard } from "../../components/onboarding/screens";
import { SwipeDeck } from "../../components/swipe/SwipeDeck";
import { useRealDeck } from "../../components/swipe/useRealDeck";
import { getRecipeFields } from "../../lib/api/recipes";
import { VStack, Heading, Text } from "../../components/ui";
import { createAnonymousUser, flushOnboarding } from "../../lib/api/auth";

/**
 * The first-run warm-up deck: a typing intro ("swipe right on what you like") over a short,
 * bounded swipe deck ranked to the answers just given, so the ranking has real like/dislike
 * signal before the first meal plan. The account is created + preferences flushed while the
 * intro types (masking that latency); once the batch is swiped we hand off to setting-up.
 */
export default function RecipeSwipe() {
  const router = useRouter();
  const [ready, setReady] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const [started, setStarted] = React.useState(false);

  const finalize = React.useCallback(async () => {
    setFailed(false);
    try {
      await createAnonymousUser();
      await flushOnboarding();
      setReady(true);
    } catch {
      setFailed(true);
    }
  }, []);

  React.useEffect(() => {
    finalize();
  }, [finalize]);

  if (failed) {
    return (
      <OnboardingScreen progress={1} showBack={false} ctaLabel="Try again" onCta={finalize}>
        <VStack className="mt-12 items-center" space={16}>
          <Heading className="text-center text-2xl">We hit a snag setting things up</Heading>
          <Text className="text-center text-muted">Check your connection and try again.</Text>
        </VStack>
      </OnboardingScreen>
    );
  }

  if (!started) {
    return (
      <OnboardingScreen
        progress={1}
        showBack={false}
        ctaLabel={ready ? "Start" : "Getting things ready…"}
        ctaDisabled={!ready}
        onCta={() => setStarted(true)}
      >
        <OnboardingValueCard
          headline="Swipe right on the recipes you like."
          body="Swipe left to pass. We'll use these to build your first meal plan."
        />
      </OnboardingScreen>
    );
  }

  return <WarmUpDeck onDone={() => router.replace("/(onboarding)/setting-up")} />;
}

/** Rendered only after the session exists, so the deck fetch is authed. */
function WarmUpDeck({ onDone }: { onDone: () => void }) {
  // No categories passed — the deck service applies the user's default meal-type filter
  // (derived from their onboarding plan) server-side, with a fallback so it's never empty.
  const controller = useRealDeck({ refill: false });

  const hydrateDetail = React.useCallback(async (id: string) => {
    const r = await getRecipeFields(id, ["ingredients", "steps"]);
    return {
      ingredients: (r.ingredients ?? []).map((i) => ({ qty: i.quantity_text ?? [i.amount, i.unit].filter(Boolean).join(" "), name: i.name })),
      steps: r.steps ?? [],
    };
  }, []);

  return (
    <SafeAreaView className="flex-1 bg-cream" edges={["top"]}>
      <Backdrop />
      <View className="flex-1 justify-center">
        <SwipeDeck
          controller={controller}
          hydrateDetail={hydrateDetail}
          headerTitle="For you"
          showSettings={false}
          onExhausted={onDone}
        />
      </View>
    </SafeAreaView>
  );
}
