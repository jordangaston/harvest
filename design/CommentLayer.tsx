import React from "react";
import { Modal, View, TextInput, StyleSheet } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { ScrollView, VStack, HStack, Text, Pressable, Icon } from "../components/ui";
import { ELEVATION } from "../lib/elevation";

export type StudyComment = {
  id: string;
  xPct: number;
  yPct: number;
  author: string;
  body: string;
  status?: "open" | "addressed";
};

/**
 * A commentable overlay for the Design Studio — wraps EVERY study (see app/studio/[name].tsx)
 * so any component can be annotated. Numbered pins sit on the component canvas. An optional
 * `seed` comes from a committed file (`design/comments/<name>.ts`) for studies that have one;
 * otherwise commenting is in-app only. Pins a human drops persist to AsyncStorage (dev-local).
 * Toggle "Comment" to annotate (which suspends the component's own gestures) or off to interact.
 */
export function CommentLayer({ studyName, seed = [], children }: { studyName: string; seed?: StudyComment[]; children: React.ReactNode }) {
  const KEY = `swipe-comments:${studyName}`;
  const [size, setSize] = React.useState({ width: 0, height: 0 });
  const [local, setLocal] = React.useState<StudyComment[]>([]);
  const [mode, setMode] = React.useState(false);
  const [draft, setDraft] = React.useState<{ xPct: number; yPct: number } | null>(null);
  const [body, setBody] = React.useState("");
  const [author, setAuthor] = React.useState("Reviewer");
  const [active, setActive] = React.useState<StudyComment | null>(null);
  const [listOpen, setListOpen] = React.useState(false);

  React.useEffect(() => {
    AsyncStorage.getItem(KEY).then((raw) => { if (raw) try { setLocal(JSON.parse(raw)); } catch {} });
  }, [KEY]);

  const persist = (next: StudyComment[]) => { setLocal(next); AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => {}); };
  const all = React.useMemo(() => [...seed, ...local], [seed, local]);

  const onCanvasTap = (e: { nativeEvent: { locationX: number; locationY: number } }) => {
    if (!size.width) return;
    setDraft({ xPct: e.nativeEvent.locationX / size.width, yPct: e.nativeEvent.locationY / size.height });
    setBody("");
  };
  const saveDraft = () => {
    if (!draft || !body.trim()) { setDraft(null); return; }
    persist([...local, { id: `local-${Date.now()}`, xPct: draft.xPct, yPct: draft.yPct, author: author.trim() || "Reviewer", body: body.trim(), status: "open" }]);
    setDraft(null); setBody("");
  };
  const removeLocal = (id: string) => persist(local.filter((c) => c.id !== id));

  return (
    <View style={{ width: "100%" }}>
      <View onLayout={(e) => setSize(e.nativeEvent.layout)} style={{ position: "relative", alignItems: "center" }}>
        {children}

        {mode ? <Pressable accessibilityLabel="Tap to place a comment" onPress={onCanvasTap} style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(46,36,25,0.06)" }]} /> : null}

        {all.map((c, i) => (
          <Pin key={c.id} n={i + 1} xPct={c.xPct} yPct={c.yPct} size={size} addressed={c.status === "addressed"} onPress={() => setActive(c)} />
        ))}
        {draft ? <Pin n={all.length + 1} xPct={draft.xPct} yPct={draft.yPct} size={size} pending /> : null}
      </View>

      {/* Controls */}
      <HStack className="mt-3 items-center justify-center" space={10}>
        <Pressable
          onPress={() => { setMode((m) => !m); setDraft(null); }}
          accessibilityRole="button"
          accessibilityLabel={mode ? "Exit comment mode" : "Enter comment mode"}
          className={`flex-row items-center rounded-full px-4 py-2 ${mode ? "bg-brand" : "bg-card"}`}
          style={{ gap: 6, borderWidth: mode ? 0 : 1, borderColor: "#E4D6BC" }}
        >
          <Icon name={mode ? "checkmark" : "chatbubble-ellipses-outline"} size={16} color={mode ? "#fff" : "#A85E2B"} />
          <Text className={`text-sm font-bold ${mode ? "text-white" : "text-brand"}`}>{mode ? "Done" : "Comment"}</Text>
        </Pressable>
        <Pressable onPress={() => setListOpen(true)} accessibilityRole="button" accessibilityLabel="View all comments" className="flex-row items-center rounded-full bg-card px-4 py-2" style={{ gap: 6, borderWidth: 1, borderColor: "#E4D6BC" }}>
          <Icon name="list-outline" size={16} color="#6E5B48" />
          <Text className="text-sm font-bold text-ink">{all.length}</Text>
        </Pressable>
      </HStack>
      {mode ? <Text className="mt-2 text-center text-xs text-muted">Tap the component to drop a numbered pin.</Text> : null}

      {/* Active-pin popover */}
      <Modal visible={!!active} transparent animationType="fade" onRequestClose={() => setActive(null)}>
        <Pressable onPress={() => setActive(null)} className="flex-1 justify-center px-8" style={{ backgroundColor: "rgba(0,0,0,0.3)" }}>
          <View className="rounded-2xl bg-cream p-5" style={{ gap: 8 }}>
            <HStack className="items-center justify-between">
              <Text className="text-sm font-bold text-brand">{active?.author}</Text>
              {active?.status === "addressed" ? <View className="rounded-full bg-success px-2 py-0.5"><Text className="text-xs font-bold text-white">Addressed</Text></View> : null}
            </HStack>
            <Text className="text-base text-ink">{active?.body}</Text>
            {active?.id.startsWith("local-") ? (
              <Pressable onPress={() => { removeLocal(active.id); setActive(null); }} className="mt-1 self-start"><Text className="text-sm font-bold text-error">Delete</Text></Pressable>
            ) : null}
          </View>
        </Pressable>
      </Modal>

      {/* Composer */}
      <Modal visible={!!draft} transparent animationType="fade" onRequestClose={() => setDraft(null)}>
        <View className="flex-1 justify-center px-8" style={{ backgroundColor: "rgba(0,0,0,0.35)" }}>
          <VStack space={12} className="rounded-2xl bg-cream p-5">
            <Text className="text-base text-ink" style={{ fontFamily: "Karla_700Bold" }}>Leave a comment</Text>
            <TextInput value={author} onChangeText={setAuthor} placeholder="Your name" placeholderTextColor="#9C8460" className="rounded-xl bg-card px-4 py-3 text-ink" style={{ fontFamily: "Karla_400Regular" }} />
            <TextInput value={body} onChangeText={setBody} placeholder="What should change here?" placeholderTextColor="#9C8460" multiline className="rounded-xl bg-card px-4 py-3 text-ink" style={{ fontFamily: "Karla_400Regular", minHeight: 90, textAlignVertical: "top" }} />
            <HStack space={10}>
              <Pressable onPress={() => setDraft(null)} className="flex-1 items-center rounded-full bg-card py-3" style={{ borderWidth: 1, borderColor: "#E4D6BC" }}><Text className="text-sm font-bold text-ink">Cancel</Text></Pressable>
              <Pressable onPress={saveDraft} className="flex-1 items-center rounded-full bg-brand py-3"><Text className="text-sm font-bold text-white">Save pin</Text></Pressable>
            </HStack>
          </VStack>
        </View>
      </Modal>

      {/* Full list */}
      <Modal visible={listOpen} transparent animationType="slide" onRequestClose={() => setListOpen(false)}>
        <View className="flex-1 justify-end" style={{ backgroundColor: "rgba(0,0,0,0.3)" }}>
          <View className="rounded-t-3xl bg-cream" style={{ maxHeight: "80%" }}>
            <HStack className="items-center justify-between px-5 pb-2 pt-4">
              <Text className="text-lg text-ink" style={{ fontFamily: "Karla_700Bold" }}>Comments ({all.length})</Text>
              <Pressable onPress={() => setListOpen(false)} accessibilityLabel="Close comments" className="rounded-full bg-card p-2"><Icon name="close" size={18} color="#2E2419" /></Pressable>
            </HStack>
            <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 8, gap: 12 }}>
              {all.length === 0 ? <Text className="text-center text-sm text-muted">No comments yet — tap “Comment”, then tap the component to add one.</Text> : null}
              {all.map((c, i) => (
                <HStack key={c.id} space={12} className="items-start rounded-2xl bg-card p-3">
                  <View className="h-6 w-6 items-center justify-center rounded-full bg-brand"><Text className="text-xs font-bold text-white">{i + 1}</Text></View>
                  <VStack className="flex-1" space={2}>
                    <HStack className="items-center justify-between">
                      <Text className="text-sm font-bold text-brand">{c.author}</Text>
                      {c.status === "addressed" ? <Text className="text-xs font-bold text-success">Addressed</Text> : null}
                    </HStack>
                    <Text className="text-sm text-ink">{c.body}</Text>
                  </VStack>
                </HStack>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function Pin({ n, xPct, yPct, size, pending, addressed, onPress }: { n: number; xPct: number; yPct: number; size: { width: number; height: number }; pending?: boolean; addressed?: boolean; onPress?: () => void }) {
  const bg = pending ? "#8C5D18" : addressed ? "#4E7A3F" : "#A85E2B";
  return (
    <Pressable
      onPress={onPress}
      disabled={pending}
      accessibilityLabel={`Comment ${n}`}
      style={[{ position: "absolute", left: xPct * size.width - 14, top: yPct * size.height - 14, height: 28, width: 28, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: bg, borderWidth: 2, borderColor: "#FBF6EC" }, ELEVATION.low]}
    >
      <Text className="text-xs font-bold text-white">{n}</Text>
    </Pressable>
  );
}
