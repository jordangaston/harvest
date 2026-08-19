import React from "react";
import { View, Animated, PanResponder, Dimensions, AccessibilityInfo, StyleSheet, Modal } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { Text, Pressable, Icon, VStack, HStack } from "../ui";
import { analytics } from "../../lib/analytics";
import { DURATION, EASE, TOAST } from "../../lib/motion";
import { ELEVATION } from "../../lib/elevation";
import { SwipeCard } from "./SwipeCard";
import { DetailSheet } from "./DetailSheet";
import { ReasonSheet } from "./ReasonSheet";
import { SettingsScreen } from "./SettingsScreen";
import { useMockDeck, DeckCard, Direction, DislikeReason, REASON_CHIPS } from "./mock";

const { width, height } = Dimensions.get("window");
const CARD_W = Math.min(width - 32, 420);
const CARD_H = Math.min(height * 0.6, 560);
const SWIPE_THRESHOLD = CARD_W * 0.32;
const UP_THRESHOLD = CARD_H * 0.22;

type StartState = "deck" | "empty" | "error";

/**
 * The swipe deck. A single gesture-interactive top card over a static card behind
 * it (Bumble's stack), with button parity, the skippable reason loop, reward/return
 * moments, and every deck state. Mock-backed for the Design Studio; swap useMockDeck
 * for the real useDeck/useSwipe to go live (docs/swipe-ui/DESIGN.md).
 */
export function SwipeDeck({
  initial = "deck", failSaves = false, forceReduceMotion,
}: {
  initial?: StartState;
  failSaves?: boolean;
  forceReduceMotion?: boolean;
}) {
  const deck = useMockDeck(initial, failSaves);
  const pos = React.useRef(new Animated.ValueXY()).current;
  const [detail, setDetail] = React.useState<DeckCard | null>(null);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [reasonFor, setReasonFor] = React.useState<{ id: string; title: string } | null>(null);
  const [cookbookFor, setCookbookFor] = React.useState<DeckCard | null>(null);
  const [toast, setToast] = React.useState<string | null>(null);
  const [showHint, setShowHint] = React.useState(true);
  const [osReduceMotion, setOsReduceMotion] = React.useState(false);
  const reduceMotion = forceReduceMotion ?? osReduceMotion;

  const top = deck.cards[0] ?? null;
  const behind = deck.cards[1] ?? null;
  const shownAt = React.useRef<number>(0);

  React.useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setOsReduceMotion).catch(() => {});
  }, []);

  // Telemetry: card exposure + start the time-per-card clock.
  React.useEffect(() => {
    if (!top) return;
    shownAt.current = Date.now();
    analytics.track("Deck Card Shown", { recipeId: top.recipe.id, score: top.score, position: deck.likeCount });
  }, [top?.recipe.id]);

  React.useEffect(() => {
    if (deck.status === "empty") analytics.track("Deck Exhausted", { swipesThisSession: deck.likeCount });
  }, [deck.status]);

  const toastTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const flash = React.useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 1600);
  }, []);

  const commit = React.useCallback(
    (direction: Direction, method: "gesture" | "button", cookbook?: string) => {
      const card = deck.cards[0];
      if (!card) return;
      setShowHint(false);
      analytics.track("Recipe Swiped", {
        recipeId: card.recipe.id, direction, method, score: card.score,
        msVisible: Date.now() - shownAt.current,
      });
      if (direction === "like" || direction === "super") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        flash(direction === "super" ? `Saved to ${cookbook ?? "your week"} ♥` : "Added to Liked ♥");
      } else {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        setReasonFor({ id: card.recipe.id, title: card.recipe.title });
      }
      deck.swipe(direction);
    },
    [deck, flash],
  );

  // Fling the top card off, then advance and reset. Honors Reduce Motion (skip travel).
  const fling = React.useCallback(
    (direction: Direction, method: "gesture" | "button", cookbook?: string) => {
      if (!deck.cards[0]) return;
      const toValue =
        direction === "super"
          ? { x: 0, y: -CARD_H * 1.3 }
          : { x: (direction === "like" ? 1 : -1) * CARD_W * 1.6, y: 0 };
      const done = () => { commit(direction, method, cookbook); pos.setValue({ x: 0, y: 0 }); };
      if (reduceMotion) return done();
      Animated.timing(pos, { toValue, duration: DURATION.fast, easing: EASE.smoothOut, useNativeDriver: false }).start(done);
    },
    [deck, commit, pos, reduceMotion],
  );

  const springBack = React.useCallback(() => {
    Animated.spring(pos, { toValue: { x: 0, y: 0 }, friction: 6, useNativeDriver: false }).start();
  }, [pos]);

  // Super/"Cook this week" opens a cookbook picker first — the card only leaves once a cookbook is chosen.
  const openCookbook = React.useCallback(() => {
    if (!deck.cards[0]) return;
    springBack();
    setCookbookFor(deck.cards[0]);
  }, [deck, springBack]);

  const saveToCookbook = React.useCallback((cookbook: string) => {
    setCookbookFor(null);
    fling("super", "button", cookbook);
  }, [fling]);

  const panResponder = React.useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 6 || Math.abs(g.dy) > 6,
        onPanResponderMove: Animated.event([null, { dx: pos.x, dy: pos.y }], { useNativeDriver: false }),
        onPanResponderRelease: (_e, g) => {
          if (g.dx > SWIPE_THRESHOLD) fling("like", "gesture");
          else if (g.dx < -SWIPE_THRESHOLD) fling("dislike", "gesture");
          else if (g.dy < -UP_THRESHOLD) openCookbook();
          else springBack();
        },
        onPanResponderTerminate: springBack,
      }),
    [pos, fling, springBack, openCookbook],
  );

  const onUndo = React.useCallback(() => {
    if (!deck.lastSwipe) return;
    analytics.track("Recipe Swiped", { recipeId: deck.lastSwipe.card.recipe.id, direction: "undo", method: "button", score: 0, msVisible: 0 });
    deck.undo();
    pos.setValue({ x: 0, y: 0 });
    setToast(null);
  }, [deck, pos]);

  const chooseReason = React.useCallback(
    (reason: DislikeReason, detail?: string) => {
      analytics.track("Swipe Reason Chosen", { recipeId: reasonFor?.id, reason, hadDetail: !!detail });
      const chip = REASON_CHIPS.find((c) => c.reason === reason);
      setReasonFor(null);
      flash(detail ? `We’ll avoid ${detail}.` : chip?.confirm ?? "Got it.");
    },
    [reasonFor, flash],
  );

  const skipReason = React.useCallback(() => {
    analytics.track("Swipe Reason Skipped", { recipeId: reasonFor?.id });
    setReasonFor(null);
  }, [reasonFor]);

  const openDetail = React.useCallback((card: DeckCard) => {
    analytics.track("Card Detail Expanded", { recipeId: card.recipe.id });
    setDetail(card);
  }, []);

  const rotate = pos.x.interpolate({ inputRange: [-CARD_W / 2, 0, CARD_W / 2], outputRange: ["-8deg", "0deg", "8deg"] });
  const likeOpacity = pos.x.interpolate({ inputRange: [0, SWIPE_THRESHOLD], outputRange: [0, 1], extrapolate: "clamp" });
  const nopeOpacity = pos.x.interpolate({ inputRange: [-SWIPE_THRESHOLD, 0], outputRange: [1, 0], extrapolate: "clamp" });
  const superOpacity = pos.y.interpolate({ inputRange: [-UP_THRESHOLD, 0], outputRange: [1, 0], extrapolate: "clamp" });

  return (
    <View style={{ width: CARD_W, alignSelf: "center" }}>
      <Header liked={deck.likeCount} onSettings={() => setSettingsOpen(true)} />

      {deck.showNudge ? (
        <NudgeBanner
          count={deck.likeCount}
          onPlan={() => { analytics.track("Plan Nudge Tapped", { likeCount: deck.likeCount }); deck.dismissNudge(); setSettingsOpen(false); }}
          onDismiss={deck.dismissNudge}
        />
      ) : null}

      <View style={{ height: CARD_H, marginTop: 12 }}>
        {deck.status === "loading" ? <LoadingCard /> : null}
        {deck.status === "error" ? <ErrorCard onRetry={deck.retry} /> : null}
        {deck.status === "empty" ? <EmptyState onSettings={() => setSettingsOpen(true)} onPlan={() => setSettingsOpen(true)} /> : null}

        {deck.status === "ready" && behind ? (
          <View style={StyleSheet.absoluteFill} pointerEvents="none">
            <SwipeCard card={behind} dimmed />
          </View>
        ) : null}

        {deck.status === "ready" && top ? (
          <Animated.View
            {...panResponder.panHandlers}
            style={[StyleSheet.absoluteFill, { transform: [{ translateX: pos.x }, { translateY: pos.y }, { rotate }] }]}
          >
            <SwipeCard card={top} onOpenDetail={() => openDetail(top)} />
            <Disc opacity={likeOpacity} side="right" icon="checkmark" />
            <Disc opacity={nopeOpacity} side="left" icon="close" />
            <Disc opacity={superOpacity} side="top" icon="arrow-up" />
            {showHint ? <GestureHint /> : null}
            {deck.failedSave?.recipe.id === top.recipe.id ? (
              <View className="absolute inset-x-4 top-4 flex-row items-center justify-center rounded-full bg-error px-3 py-2" style={{ gap: 6 }}>
                <Icon name="refresh" size={14} color="#fff" />
                <Text className="text-xs font-bold text-white">Didn’t save — swipe again</Text>
              </View>
            ) : null}
          </Animated.View>
        ) : null}
        {toast ? <RewardToast message={toast} /> : null}
      </View>

      {deck.status === "ready" && top ? (
        <ActionBar
          canUndo={!!deck.lastSwipe}
          onUndo={onUndo}
          onPass={() => fling("dislike", "button")}
          onSuper={openCookbook}
          onLike={() => fling("like", "button")}
        />
      ) : null}

      <DetailSheet card={detail} visible={!!detail} onClose={() => setDetail(null)} />
      <ReasonSheet visible={!!reasonFor} onChoose={chooseReason} onSkip={skipReason} />
      <CookbookPicker visible={!!cookbookFor} recipeTitle={cookbookFor?.recipe.title ?? null} onSelect={saveToCookbook} onClose={() => setCookbookFor(null)} />
      <SettingsScreen visible={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </View>
  );
}

/* ---------- Header ---------- */
function Header({ liked, onSettings }: { liked: number; onSettings: () => void }) {
  return (
    <View className="flex-row items-center justify-between">
      <Text className="text-2xl text-ink" style={{ fontFamily: "Lora_700Bold" }}>Tonight</Text>
      <View className="flex-row items-center" style={{ gap: 10 }}>
        <View className="flex-row items-center" style={{ gap: 4 }}>
          <Icon name="heart" size={15} color="#6E5B48" />
          <Text className="text-sm font-semibold text-muted">{liked}</Text>
        </View>
        <Pressable onPress={onSettings} accessibilityRole="button" accessibilityLabel="Ranking preferences" className="rounded-full bg-card p-2.5" style={ELEVATION.low}>
          <Icon name="options-outline" size={20} color="#2E2419" />
        </Pressable>
      </View>
    </View>
  );
}

/* ---------- Drag feedback disc (monochrome frosted, per D-02) ---------- */
function Disc({ opacity, side, icon }: { opacity: Animated.AnimatedInterpolation<number>; side: "left" | "right" | "top"; icon: React.ComponentProps<typeof Icon>["name"] }) {
  const place =
    side === "right" ? { right: 24, top: "42%" as const }
    : side === "left" ? { left: 24, top: "42%" as const }
    : { top: 24, alignSelf: "center" as const };
  return (
    <Animated.View style={[{ position: "absolute", opacity, height: 84, width: 84, borderRadius: 42, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(251,246,236,0.92)" }, place]}>
      <Icon name={icon} size={44} color="#2E2419" />
    </Animated.View>
  );
}

/* ---------- Action bar (button parity for every gesture, each captioned) ---------- */
function ActionBar({ canUndo, onUndo, onPass, onSuper, onLike }: { canUndo: boolean; onUndo: () => void; onPass: () => void; onSuper: () => void; onLike: () => void }) {
  return (
    <View className="mt-5 flex-row items-start justify-center" style={{ gap: 14 }}>
      <ActionBtn size={48} bg="bg-card" caption="Undo" label="Undo last swipe" disabled={!canUndo} onPress={onUndo}>
        <Icon name="arrow-undo" size={20} color="#6E5B48" />
      </ActionBtn>
      <ActionBtn size={66} bg="bg-error" caption="Pass" label="Pass on this recipe" onPress={onPass}>
        <Icon name="close" size={30} color="#fff" />
      </ActionBtn>
      <ActionBtn size={58} bg="bg-brand" caption="Cook" label="Cook this week — choose a cookbook" onPress={onSuper}>
        <Icon name="bookmark" size={24} color="#fff" />
      </ActionBtn>
      <ActionBtn size={66} bg="bg-success" caption="Like" label="Like this recipe" onPress={onLike}>
        <Icon name="heart" size={30} color="#fff" />
      </ActionBtn>
    </View>
  );
}

function ActionBtn({ size, bg, caption, label, disabled, onPress, children }: { size: number; bg: string; caption: string; label: string; disabled?: boolean; onPress: () => void; children: React.ReactNode }) {
  return (
    <VStack className="items-center" space={6} style={{ width: 72 }}>
      <View style={{ height: 66, justifyContent: "center" }}>
        <Pressable
          onPress={disabled ? undefined : onPress}
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityState={{ disabled: !!disabled }}
          className={`items-center justify-center rounded-full ${bg}`}
          style={[{ height: size, width: size, opacity: disabled ? 0.5 : 1 }, ELEVATION.medium]}
        >
          {children}
        </Pressable>
      </View>
      <Text className="text-xs font-semibold" style={{ color: disabled ? "#C7B89A" : "#6E5B48" }}>{caption}</Text>
    </VStack>
  );
}

/* ---------- Cookbook picker — the super/"Cook this week" action saves to a chosen cookbook ---------- */
const MOCK_COOKBOOKS = ["This Week", "Weeknight Dinners", "Favorites"];
function CookbookPicker({ visible, recipeTitle, onSelect, onClose }: { visible: boolean; recipeTitle: string | null; onSelect: (cookbook: string) => void; onClose: () => void }) {
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View className="flex-1 justify-end" style={{ backgroundColor: "rgba(0,0,0,0.3)" }}>
        <View className="rounded-t-3xl bg-cream" style={{ maxHeight: "72%" }}>
          <SafeAreaView edges={["bottom"]}>
            <HStack className="items-center justify-between px-5 pb-2 pt-4">
              <VStack className="flex-1 pr-3">
                <Text className="text-lg text-ink" style={{ fontFamily: "Karla_700Bold" }}>Save to a cookbook</Text>
                {recipeTitle ? <Text className="text-xs text-muted" numberOfLines={1}>{recipeTitle}</Text> : null}
              </VStack>
              <Pressable onPress={onClose} accessibilityLabel="Close" className="rounded-full bg-card p-2"><Icon name="close" size={18} color="#2E2419" /></Pressable>
            </HStack>
            <VStack space={0} className="mx-5 mb-3 overflow-hidden rounded-2xl">
              {MOCK_COOKBOOKS.map((cb, i) => (
                <View key={cb}>
                  {i > 0 ? <View className="h-px bg-hairline" /> : null}
                  <Pressable onPress={() => onSelect(cb)} accessibilityRole="button" accessibilityLabel={`Save to ${cb}`} className="flex-row items-center justify-between bg-card px-4 py-4">
                    <HStack space={12} className="items-center">
                      <View className="h-9 w-9 items-center justify-center rounded-full bg-brand-light"><Icon name="book-outline" size={18} color="#A85E2B" /></View>
                      <Text className="text-base font-semibold text-ink">{cb}</Text>
                    </HStack>
                    <Icon name="chevron-forward" size={18} color="#6E5B48" />
                  </Pressable>
                </View>
              ))}
            </VStack>
            <Pressable onPress={() => onSelect("New cookbook")} accessibilityRole="button" accessibilityLabel="Save to a new cookbook" className="mx-5 mb-4 flex-row items-center justify-center rounded-full bg-brand py-3" style={{ gap: 6 }}>
              <Icon name="add" size={18} color="#fff" /><Text className="text-sm font-bold text-white">New cookbook</Text>
            </Pressable>
          </SafeAreaView>
        </View>
      </View>
    </Modal>
  );
}

/* ---------- First-use gesture hint (the only tutorial element in scope) ---------- */
function GestureHint() {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} className="items-center justify-center">
      <View className="items-center rounded-2xl px-5 py-4" style={{ backgroundColor: "rgba(20,12,4,0.62)", gap: 8 }}>
        <View className="flex-row items-center" style={{ gap: 14 }}>
          <HintArrow icon="arrow-back" text="Pass" />
          <HintArrow icon="arrow-up" text="Cook" />
          <HintArrow icon="arrow-forward" text="Like" />
        </View>
        <Text className="text-sm font-semibold text-white">Swipe or use the buttons below</Text>
      </View>
    </View>
  );
}
function HintArrow({ icon, text }: { icon: React.ComponentProps<typeof Icon>["name"]; text: string }) {
  return (
    <View className="items-center" style={{ gap: 2 }}>
      <Icon name={icon} size={20} color="#fff" />
      <Text className="text-xs text-white/90">{text}</Text>
    </View>
  );
}

/* ---------- Reward toast (light positive confirmation) ---------- */
function RewardToast({ message }: { message: string }) {
  const a = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    Animated.timing(a, { toValue: 1, duration: TOAST.inMs, easing: EASE.smoothOut, useNativeDriver: true }).start();
  }, []);
  return (
    <Animated.View
      pointerEvents="none"
      style={{ position: "absolute", top: 12, left: 0, right: 0, alignItems: "center", opacity: a, transform: [{ translateY: a.interpolate({ inputRange: [0, 1], outputRange: [-TOAST.rise, 0] }) }] }}
    >
      <View className="flex-row items-center rounded-full bg-success px-4 py-2.5" style={[{ gap: 6 }, ELEVATION.medium]}>
        <Icon name="checkmark-circle" size={16} color="#fff" />
        <Text className="text-sm font-bold text-white">{message}</Text>
      </View>
    </Animated.View>
  );
}

/* ---------- Return nudge → meal planning ---------- */
function NudgeBanner({ count, onPlan, onDismiss }: { count: number; onPlan: () => void; onDismiss: () => void }) {
  React.useEffect(() => { analytics.track("Plan Nudge Shown", { likeCount: count }); }, []);
  return (
    <View className="mt-3 flex-row items-center rounded-2xl bg-brand-light p-3" style={{ gap: 10 }}>
      <View className="h-9 w-9 items-center justify-center rounded-full bg-brand">
        <Icon name="calendar" size={18} color="#fff" />
      </View>
      <View className="flex-1">
        <Text className="text-sm font-bold text-ink">You’ve liked {count} — plan your week?</Text>
        <Text className="text-xs text-muted-canvas">Turn your likes into a meal plan.</Text>
      </View>
      <Pressable onPress={onPlan} accessibilityRole="button" accessibilityLabel="Plan my week" className="rounded-full bg-brand px-3.5 py-2">
        <Text className="text-xs font-bold text-white">Plan</Text>
      </Pressable>
      <Pressable onPress={onDismiss} accessibilityRole="button" accessibilityLabel="Dismiss" className="p-1">
        <Icon name="close" size={16} color="#6E5B48" />
      </Pressable>
    </View>
  );
}

/* ---------- States ---------- */
function LoadingCard() {
  const a = React.useRef(new Animated.Value(0.4)).current;
  React.useEffect(() => {
    Animated.loop(Animated.sequence([
      Animated.timing(a, { toValue: 0.8, duration: DURATION.slow, useNativeDriver: true }),
      Animated.timing(a, { toValue: 0.4, duration: DURATION.slow, useNativeDriver: true }),
    ])).start();
  }, []);
  return <Animated.View style={[StyleSheet.absoluteFill, { opacity: a }]} className="rounded-xl2 bg-card" />;
}

function ErrorCard({ onRetry }: { onRetry: () => void }) {
  return (
    <View style={StyleSheet.absoluteFill} className="items-center justify-center rounded-xl2 bg-card px-8" >
      <View className="items-center" style={{ gap: 12 }}>
        <Icon name="cloud-offline-outline" size={40} color="#8C5D18" />
        <Text className="text-center text-base font-bold text-ink">Couldn’t load recipes</Text>
        <Pressable onPress={onRetry} accessibilityRole="button" accessibilityLabel="Retry" className="rounded-full bg-brand px-5 py-2.5">
          <Text className="text-sm font-bold text-white">Retry</Text>
        </Pressable>
      </View>
    </View>
  );
}

function EmptyState({ onSettings, onPlan }: { onSettings: () => void; onPlan: () => void }) {
  return (
    <View style={StyleSheet.absoluteFill} className="items-center justify-center rounded-xl2 bg-card px-8">
      <View className="items-center" style={{ gap: 14 }}>
        <View className="h-16 w-16 items-center justify-center rounded-full bg-brand-light">
          <Icon name="checkmark-done" size={34} color="#A85E2B" />
        </View>
        <Text className="text-center text-xl text-ink" style={{ fontFamily: "Karla_700Bold" }}>You’re all caught up</Text>
        <Text className="text-center text-sm text-muted">Check back later for more, or tweak your preferences to widen the net.</Text>
        <View className="mt-1 w-full" style={{ gap: 8 }}>
          <Pressable onPress={onPlan} accessibilityRole="button" accessibilityLabel="Plan my week" className="items-center rounded-full bg-brand py-3">
            <Text className="text-sm font-bold text-white">Plan my week</Text>
          </Pressable>
          <Pressable onPress={onSettings} accessibilityRole="button" accessibilityLabel="Adjust preferences" className="items-center rounded-full bg-card py-3" style={ELEVATION.low}>
            <Text className="text-sm font-bold text-brand">Adjust preferences</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}
