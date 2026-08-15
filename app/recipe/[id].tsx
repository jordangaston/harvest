import React from "react";
import { View, ScrollView, Modal, StyleSheet } from "react-native";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import * as Haptics from "expo-haptics";
import {
  VStack,
  HStack,
  Center,
  Text,
  Heading,
  Pressable,
  Button,
  ButtonText,
  Icon,
  Input,
  Spinner,
} from "../../components/ui";
import { StepText } from "../../components/recime/StepText";
import { CookbookPickerSheet } from "../../components/recime/CookbookPickerSheet";
import { AddToPlanSheet } from "../../components/recime/AddToPlanSheet";
import { Toast, useToast } from "../../components/recime/Toast";
import { mealLabel } from "../../components/recime/meals";
import { resolveIcon } from "../../components/recime/recipes";
import { useQueryClient } from "@tanstack/react-query";
import { updateRecipe, deleteRecipe } from "../../lib/api/recipes";
import { useRecipe } from "../../lib/api/hooks";
import { queryKeys } from "../../lib/queryKeys";
import { setSavedToast } from "../../lib/savedToast";
import type { ApiIngredient } from "../../lib/api/types";

/** Small square ingredient icon — a painterly asset, falling back to the branded
 * Harvest-H (resolveIcon never returns null). */
function IngredientIcon({ icon, size = 40 }: { icon?: string; size?: number }) {
  return <Image source={resolveIcon(icon)} contentFit="cover" style={{ width: size, height: size, borderRadius: 10 }} />;
}

export default function RecipeDetail() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id, mode } = useLocalSearchParams<{ id: string; mode?: string }>();
  const isPreview = mode === "preview";

  const qc = useQueryClient();
  const { data: recipe, isError: loadFailed } = useRecipe(id);
  const [imageFailed, setImageFailed] = React.useState(false);
  const [popIng, setPopIng] = React.useState<ApiIngredient | null>(null);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [planOpen, setPlanOpen] = React.useState(false);
  const [toast, setToast] = React.useState<string | null>(null);
  const showToast = useToast(setToast);
  const [confirmDelete, setConfirmDelete] = React.useState(false);

  const [editing, setEditing] = React.useState(false);
  const [editIngredients, setEditIngredients] = React.useState<string[]>([]);
  const [editSteps, setEditSteps] = React.useState<string[]>([]);
  const [saving, setSaving] = React.useState(false);

  const tapIngredient = (ing: ApiIngredient) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setPopIng(ing);
  };

  const startEditing = () => {
    if (!recipe) return;
    setEditIngredients(recipe.ingredients.map((i) => i.name));
    setEditSteps(recipe.steps);
    setMenuOpen(false);
    setEditing(true);
  };

  const saveEdits = async () => {
    if (!id) return;
    setSaving(true);
    try {
      const updated = await updateRecipe(id, {
        ingredients: editIngredients.map((s) => s.trim()).filter(Boolean),
        steps: editSteps.map((s) => s.trim()).filter(Boolean),
      });
      // Write the edit straight into the cache so the detail re-renders fresh
      // without a refetch.
      qc.setQueryData(queryKeys.recipe(id), updated);
      setEditing(false);
    } catch {
      // keep editing so the user can retry
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async () => {
    if (!id) return;
    setConfirmDelete(false);
    try {
      await deleteRecipe(id);
      // Drop this recipe and refresh the cookbooks (recipe_count changed).
      qc.removeQueries({ queryKey: queryKeys.recipe(id) });
      qc.invalidateQueries({ queryKey: queryKeys.cookbooks });
    } catch {
      // best-effort; still leave the screen
    }
    router.replace("/(app)/recipes");
  };

  const goBack = () => (isPreview ? router.replace("/(app)/recipes") : router.back());

  if (loadFailed) {
    return (
      <Center className="flex-1 bg-cream px-8">
        <Text className="mb-6 text-center text-muted">This recipe couldn&apos;t be loaded.</Text>
        <Button onPress={() => router.replace("/(app)/recipes")}>
          <ButtonText>Back to recipes</ButtonText>
        </Button>
      </Center>
    );
  }
  if (!recipe) {
    return (
      <Center className="flex-1 bg-cream">
        <Spinner />
      </Center>
    );
  }

  return (
    <View className="flex-1 bg-cream">
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 130 }}>
        {/* hero */}
        <View>
          {recipe.image_url && !imageFailed ? (
            // Blur-fill: a blurred cover backdrop fills the frame (any aspect ratio),
            // the contained image sits on top so nothing — incl. a 9:16 Short — is cut off.
            <View className="bg-brand-light" style={{ width: "100%", height: 300 }}>
              <Image source={{ uri: recipe.image_url }} contentFit="cover" blurRadius={28} style={StyleSheet.absoluteFill} />
              <Image
                source={{ uri: recipe.image_url }}
                contentFit="contain"
                transition={200}
                onError={() => setImageFailed(true)}
                style={StyleSheet.absoluteFill}
              />
            </View>
          ) : (
            <Center className="bg-brand-light" style={{ width: "100%", height: 260 }}>
              <Icon name="restaurant-outline" size={64} color="#A85E2B" />
            </Center>
          )}
          <Pressable
            onPress={goBack}
            style={{ position: "absolute", top: insets.top + 6, left: 16 }}
            className="h-10 w-10 items-center justify-center rounded-full bg-black/40"
          >
            <Icon name="chevron-back" size={24} color="#fff" />
          </Pressable>
          {!isPreview && !editing ? (
            <Pressable
              onPress={() => setMenuOpen(true)}
              style={{ position: "absolute", top: insets.top + 6, right: 16 }}
              className="h-10 w-10 items-center justify-center rounded-full bg-black/40"
            >
              <Icon name="ellipsis-horizontal" size={22} color="#fff" />
            </Pressable>
          ) : null}
        </View>

        <VStack className="px-6 pt-5" space={14}>
          <Heading className="text-3xl">{recipe.title}</Heading>

          {/* ingredients */}
          <VStack space={10}>
            <Text className="text-base font-bold text-ink">INGREDIENTS</Text>
            {editing ? (
              <VStack space={8}>
                {editIngredients.map((line, i) => (
                  <HStack key={i} className="items-center" space={8}>
                    <Input
                      value={line}
                      onChangeText={(t) => setEditIngredients((prev) => prev.map((v, j) => (j === i ? t : v)))}
                      className="flex-1"
                      placeholder="Ingredient"
                    />
                    <Pressable onPress={() => setEditIngredients((prev) => prev.filter((_, j) => j !== i))} className="p-1">
                      <Icon name="close-circle" size={24} color="#B23A2E" />
                    </Pressable>
                  </HStack>
                ))}
                <Pressable
                  onPress={() => setEditIngredients((prev) => [...prev, ""])}
                  className="flex-row items-center self-start py-1"
                >
                  <Icon name="add-circle" size={22} color="#A85E2B" />
                  <Text className="ml-1.5 font-semibold text-brand-dark">Add ingredient</Text>
                </Pressable>
              </VStack>
            ) : (
              recipe.ingredients.map((ing, i) => (
                <Pressable key={i} onPress={() => tapIngredient(ing)}>
                  <HStack className="items-center" space={12}>
                    <IngredientIcon icon={ing.icon} />
                    <Text className="flex-1 text-base text-ink">{ing.name}</Text>
                  </HStack>
                </Pressable>
              ))
            )}
          </VStack>

          {/* instructions */}
          <VStack space={12}>
            <Text className="text-base font-bold text-ink">INSTRUCTIONS</Text>
            {editing ? (
              <VStack space={8}>
                {editSteps.map((line, i) => (
                  <HStack key={i} className="items-start" space={8}>
                    <Center className="mt-2 h-7 w-7 rounded-full bg-brand">
                      <Text className="text-sm font-bold text-white">{i + 1}</Text>
                    </Center>
                    <Input
                      value={line}
                      onChangeText={(t) => setEditSteps((prev) => prev.map((v, j) => (j === i ? t : v)))}
                      className="h-auto flex-1 py-2"
                      multiline
                      placeholder="Step"
                    />
                    <Pressable onPress={() => setEditSteps((prev) => prev.filter((_, j) => j !== i))} className="mt-2 p-1">
                      <Icon name="close-circle" size={24} color="#B23A2E" />
                    </Pressable>
                  </HStack>
                ))}
                <Pressable onPress={() => setEditSteps((prev) => [...prev, ""])} className="flex-row items-center self-start py-1">
                  <Icon name="add-circle" size={22} color="#A85E2B" />
                  <Text className="ml-1.5 font-semibold text-brand-dark">Add step</Text>
                </Pressable>
              </VStack>
            ) : (
              recipe.steps.map((step, i) => (
                <HStack key={i} className="items-start" space={12}>
                  <Center className="mt-0.5 h-7 w-7 rounded-full bg-brand">
                    <Text className="text-sm font-bold text-white">{i + 1}</Text>
                  </Center>
                  <StepText step={step} ingredients={recipe.ingredients} onSelect={tapIngredient} />
                </HStack>
              ))
            )}
          </VStack>
          {!editing ? (
            <Text className="mt-2 text-center text-xs text-muted">Tap an ingredient in a step to see its amount</Text>
          ) : null}
        </VStack>
      </ScrollView>

      {/* sticky bottom bar */}
      <View
        className="absolute inset-x-0 bottom-0 border-t border-hairline bg-cream px-6 pt-3"
        style={{ paddingBottom: insets.bottom + 10 }}
      >
        {editing ? (
          <HStack space={12}>
            <Button action="light" className="flex-1" onPress={() => setEditing(false)}>
              <ButtonText className="text-ink">Cancel</ButtonText>
            </Button>
            <Button className="flex-1" onPress={saveEdits} disabled={saving} style={{ opacity: saving ? 0.6 : 1 }}>
              <ButtonText>{saving ? "Saving…" : "Save changes"}</ButtonText>
            </Button>
          </HStack>
        ) : isPreview ? (
          <Button className="w-full" onPress={() => setPickerOpen(true)}>
            <Icon name="bookmark" size={18} color="#fff" />
            <ButtonText className="ml-2">Save to cookbook</ButtonText>
          </Button>
        ) : (
          <Button className="w-full" onPress={startEditing}>
            <Icon name="create-outline" size={18} color="#fff" />
            <ButtonText className="ml-2">Edit recipe</ButtonText>
          </Button>
        )}
      </View>

      {/* ingredient amount popover */}
      <Modal visible={popIng !== null} transparent animationType="fade" onRequestClose={() => setPopIng(null)}>
        <Pressable className="flex-1 justify-end bg-black/40" onPress={() => setPopIng(null)}>
          <Pressable onPress={() => {}}>
            <View className="rounded-t-3xl bg-cream px-6 pb-10 pt-5" style={{ paddingBottom: insets.bottom + 20 }}>
              <View className="mb-4 h-1.5 w-10 self-center rounded-full bg-hairline" />
              <HStack className="items-center" space={14}>
                <IngredientIcon icon={popIng?.icon} size={56} />
                <VStack className="flex-1">
                  <Text className="text-lg font-bold text-ink">{popIng?.name}</Text>
                  {popIng?.quantity_text || popIng?.amount ? (
                    <Text className="text-sm text-muted">
                      {popIng?.quantity_text ?? [popIng?.amount, popIng?.unit].filter(Boolean).join(" ")}
                    </Text>
                  ) : null}
                </VStack>
              </HStack>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ⋯ menu */}
      <Modal visible={menuOpen} transparent animationType="slide" onRequestClose={() => setMenuOpen(false)}>
        <Pressable className="flex-1 bg-black/30" onPress={() => setMenuOpen(false)}>
          <View className="mt-auto">
            <Pressable onPress={() => {}}>
              <View className="rounded-t-3xl bg-cream px-5 pb-10 pt-6" style={{ paddingBottom: insets.bottom + 16 }}>
                <Pressable
                  onPress={() => {
                    setMenuOpen(false);
                    setPlanOpen(true);
                  }}
                  className="flex-row items-center py-3.5"
                >
                  <Icon name="calendar-outline" size={22} color="#2E2419" />
                  <Text className="ml-3 text-base font-semibold text-ink">Add to meal plan</Text>
                </Pressable>
                <Pressable onPress={startEditing} className="flex-row items-center py-3.5">
                  <Icon name="create-outline" size={22} color="#2E2419" />
                  <Text className="ml-3 text-base font-semibold text-ink">Edit recipe</Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    setMenuOpen(false);
                    setConfirmDelete(true);
                  }}
                  className="flex-row items-center py-3.5"
                >
                  <Icon name="trash-outline" size={22} color="#B23A2E" />
                  <Text className="ml-3 text-base font-semibold text-error">Delete recipe</Text>
                </Pressable>
              </View>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      {/* delete confirm */}
      <Modal visible={confirmDelete} transparent animationType="fade">
        <Center className="flex-1 bg-black/40 px-10">
          <View className="w-full rounded-3xl bg-cream px-6 py-6">
            <Text className="mb-2 text-center text-xl font-bold text-ink">Delete this recipe?</Text>
            <Text className="mb-6 text-center text-muted">It will be removed from your recipes and cookbooks.</Text>
            <Button className="w-full bg-error" onPress={onDelete}>
              <ButtonText>Delete</ButtonText>
            </Button>
            <Pressable className="mt-2 py-2.5" onPress={() => setConfirmDelete(false)}>
              <Text className="text-center font-semibold text-brand-dark">Cancel</Text>
            </Pressable>
          </View>
        </Center>
      </Modal>

      {/* save-to-cookbook flow — no success modal; land home with a brief toast */}
      <CookbookPickerSheet
        visible={pickerOpen}
        recipeIds={[recipe.id]}
        onClose={() => setPickerOpen(false)}
        onSaved={(names) => {
          setPickerOpen(false);
          setSavedToast(names.length === 1 ? names[0] : `${names.length} cookbooks`);
          router.replace("/(app)/recipes");
        }}
      />

      {/* add-to-meal-plan flow — recipe pre-chosen; a day-picker then a meal */}
      <AddToPlanSheet
        visible={planOpen}
        recipeId={recipe.id}
        onClose={() => setPlanOpen(false)}
        onAdded={(meal, dayLabel) => {
          setPlanOpen(false);
          showToast(`Added to ${mealLabel(meal)} · ${dayLabel}`);
        }}
      />

      {toast ? <Toast message={toast} /> : null}
    </View>
  );
}
