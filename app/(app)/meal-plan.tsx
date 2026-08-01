import React from "react";
import { View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Backdrop } from "../../components/recime/Backdrop";
import { Box, VStack, HStack, Center, ScrollView, Text, Heading, Pressable, Icon } from "../../components/ui";

const DAYS = [
  { label: "Monday 27", today: false },
  { label: "Tuesday 28", today: false },
  { label: "Wednesday 29", today: false },
  { label: "Thursday 30", today: false },
  { label: "Friday 31", today: false },
  { label: "Today · Saturday 1", today: true },
  { label: "Sunday 2", today: false },
];

export default function MealPlan() {
  return (
    <SafeAreaView className="flex-1 bg-cream" edges={["top"]}>
      <Backdrop />
      <HStack className="items-center justify-between px-5 pt-2">
        <Heading className="text-2xl">My Meal Plan</Heading>
        <Pressable className="h-9 w-9 items-center justify-center rounded-full bg-gray-100">
          <Icon name="ellipsis-horizontal" size={20} color="#2E2419" />
        </Pressable>
      </HStack>

      <HStack className="items-center justify-center px-5 py-4" space={16}>
        <Pressable>
          <Icon name="chevron-back" size={22} color="#2E2419" />
        </Pressable>
        <Text className="text-base font-semibold text-ink">27 Jul 2026 – 02 Aug 2026</Text>
        <Pressable>
          <Icon name="chevron-forward" size={22} color="#2E2419" />
        </Pressable>
      </HStack>

      <ScrollView className="flex-1">
        {DAYS.map((day) => (
          <View key={day.label}>
            <HStack className="items-start justify-between px-5 py-5">
              <VStack space={4}>
                <Text className={`text-base font-bold ${day.today ? "text-brand" : "text-ink"}`}>
                  {day.label}
                </Text>
                <Text className="text-muted">No recipes yet</Text>
              </VStack>
              <Center className="h-8 w-8 rounded-full bg-gray-100">
                <Icon name="add" size={20} color="#2E2419" />
              </Center>
            </HStack>
            <View className="mx-5 h-px bg-muted" />
          </View>
        ))}
        <Box className="h-24" />
      </ScrollView>

      <Pressable className="absolute bottom-6 right-6 h-14 w-14 items-center justify-center rounded-full bg-brand shadow-lg">
        <Icon name="add" size={30} color="#fff" />
      </Pressable>
    </SafeAreaView>
  );
}
