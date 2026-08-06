import React from "react";
import { Modal, View, ScrollView } from "react-native";
import { Box, HStack, VStack, Text, Pressable, Button, ButtonText, Icon, Checkbox, Center } from "../ui";
import { NewCookbookSheet } from "./NewCookbookSheet";
import { listCookbooks } from "../../lib/api/cookbooks";
import { setRecipeCookbooks } from "../../lib/api/recipes";
import type { ApiCookbook } from "../../lib/api/types";

/**
 * The "Save to" sheet: pick one or more cookbooks (multi-select) for a recipe,
 * or create a new one inline and file into it — all without leaving the screen.
 * On Save, sets the recipe's cookbook membership.
 */
export function CookbookPickerSheet({
  visible,
  recipeId,
  onClose,
  onSaved,
}: {
  visible: boolean;
  recipeId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [cookbooks, setCookbooks] = React.useState<ApiCookbook[]>([]);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [newOpen, setNewOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!visible) return;
    listCookbooks()
      .then(setCookbooks)
      .catch(() => setCookbooks([]));
  }, [visible]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const save = async () => {
    setBusy(true);
    try {
      await setRecipeCookbooks(recipeId, [...selected]);
      onSaved();
    } catch {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable className="flex-1 bg-black/30" onPress={onClose}>
        <View className="mt-auto">
          <Pressable onPress={() => {}}>
            <Box className="rounded-t-3xl bg-card px-5 pb-10 pt-4">
              <View className="mb-4 h-1.5 w-10 self-center rounded-full bg-hairline" />
              <HStack className="mb-4 items-center justify-between">
                <Text className="text-xl font-bold text-ink">Save to</Text>
                <Pressable onPress={onClose}>
                  <Icon name="close" size={22} color="#6E5B48" />
                </Pressable>
              </HStack>

              <Pressable
                onPress={() => setNewOpen(true)}
                className="mb-2 flex-row items-center rounded-2xl border border-brand bg-brand-light px-4 py-3.5"
              >
                <Center className="mr-3 h-9 w-9 rounded-full bg-brand">
                  <Icon name="add" size={20} color="#fff" />
                </Center>
                <Text className="text-base font-semibold text-ink">New cookbook</Text>
              </Pressable>

              <ScrollView style={{ maxHeight: 320 }} showsVerticalScrollIndicator={false}>
                {cookbooks.length === 0 ? (
                  <Text className="px-1 py-4 text-center text-muted">No cookbooks yet — create one above.</Text>
                ) : (
                  cookbooks.map((cb) => (
                    <Pressable
                      key={cb.id}
                      onPress={() => toggle(cb.id)}
                      className="flex-row items-center justify-between rounded-2xl px-2 py-3"
                    >
                      <VStack>
                        <Text className="text-base font-semibold text-ink">{cb.name}</Text>
                        <Text className="text-xs text-muted">
                          {cb.recipe_count} {cb.recipe_count === 1 ? "recipe" : "recipes"}
                        </Text>
                      </VStack>
                      <Checkbox checked={selected.has(cb.id)} onToggle={() => toggle(cb.id)} />
                    </Pressable>
                  ))
                )}
              </ScrollView>

              <Button
                className="mt-4 w-full"
                onPress={save}
                disabled={busy || selected.size === 0}
                style={{ opacity: busy || selected.size === 0 ? 0.5 : 1 }}
              >
                <Icon name="bookmark" size={18} color="#fff" />
                <ButtonText className="ml-2">{busy ? "Saving…" : "Save"}</ButtonText>
              </Button>
            </Box>
          </Pressable>
        </View>
      </Pressable>

      <NewCookbookSheet
        visible={newOpen}
        onClose={() => setNewOpen(false)}
        onCreated={(cb) => {
          setCookbooks((prev) => [cb, ...prev]);
          setSelected((prev) => new Set(prev).add(cb.id));
        }}
      />
    </Modal>
  );
}
