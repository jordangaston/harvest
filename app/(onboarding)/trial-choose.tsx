import React from "react";
import { View, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Backdrop } from "../../components/recime/Backdrop";
import { useRouter } from "expo-router";
import {
  VStack,
  HStack,
  Text,
  Heading,
  Center,
  Icon,
  Radio,
  Switch,
  Button,
  ButtonText,
  Pressable,
} from "../../components/ui";

const PLUS = "#5C6350";

function FoodPhoto({ tag, className }: { tag?: string; className?: string }) {
  return (
    <View className={`h-24 w-24 rounded-2xl bg-gray-200 ${className ?? ""}`}>
      <Center className="flex-1">
        <Text className="text-2xl">🍲</Text>
      </Center>
      {tag ? (
        <View className="absolute -bottom-2 left-2 rounded-md bg-[#F2C744] px-2 py-1">
          <Text className="text-[11px] font-bold text-ink">{tag}</Text>
        </View>
      ) : null}
    </View>
  );
}

export default function TrialChoose() {
  const router = useRouter();
  const [plan, setPlan] = React.useState<"free" | "paid">("free");
  const [remind, setRemind] = React.useState(true);

  return (
    <SafeAreaView className="flex-1 bg-cream" edges={["top", "bottom"]}>
      <Backdrop />
      <View className="flex-row items-center justify-end px-6 pt-2">
        <Pressable onPress={() => router.back()}>
          <Icon name="close" size={26} color="#2E2419" />
        </Pressable>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 24 }}
        showsVerticalScrollIndicator={false}
      >
        <HStack className="items-start justify-between px-2" space={8}>
          <FoodPhoto tag="Healthy" />
          <FoodPhoto tag="Pasta Dinner" />
        </HStack>

        <Center className="mt-8">
          <Heading className="text-center text-3xl leading-9">
            Choose your{"\n"}
            <Text className="text-3xl font-bold text-plus">trial experience</Text>
          </Heading>
        </Center>

        <VStack className="mt-6" space={12}>
          <Pressable onPress={() => setPlan("free")}>
            <HStack
              className={`items-center justify-between rounded-2xl border-2 bg-white px-5 py-4 ${
                plan === "free" ? "border-plus" : "border-hairline"
              }`}
            >
              <VStack>
                <Text className="text-base font-bold text-ink">FREE</Text>
                <Text className="text-sm text-muted">7 Day Trial</Text>
              </VStack>
              <Radio selected={plan === "free"} onSelect={() => setPlan("free")} color={PLUS} />
            </HStack>
          </Pressable>

          <Pressable onPress={() => setPlan("paid")}>
            <HStack
              className={`items-center justify-between rounded-2xl border-2 bg-white px-5 py-4 ${
                plan === "paid" ? "border-plus" : "border-hairline"
              }`}
            >
              <VStack>
                <Text className="text-base font-bold text-ink">$1.99</Text>
                <Text className="text-sm text-muted">30 Day Trial</Text>
              </VStack>
              <Radio selected={plan === "paid"} onSelect={() => setPlan("paid")} color={PLUS} />
            </HStack>
          </Pressable>
        </VStack>

        <HStack className="mt-4 items-center justify-between rounded-2xl bg-[#EFE6D6] px-5 py-3">
          <Text className="text-[15px] text-ink">Remind me before my trial ends</Text>
          <Switch value={remind} onValueChange={setRemind} color={PLUS} />
        </HStack>

        <Center className="mt-6">
          <Text className="text-[15px] font-semibold text-plus">View All Plans</Text>
        </Center>

        <HStack className="mt-6 items-center justify-center" space={24}>
          <Center>
            <Text className="text-2xl font-extrabold text-plus">10M+</Text>
            <Text className="text-[13px] font-semibold text-ink">Happy Cooks</Text>
          </Center>
          <Center>
            <Text className="text-[13px] font-semibold text-ink">4.8 STARS</Text>
            <Text className="text-base">⭐⭐⭐⭐⭐</Text>
          </Center>
        </HStack>

        <Center className="mt-4">
          <Text className="text-[13px] font-semibold text-ink">Made in USA 🇺🇸</Text>
        </Center>
      </ScrollView>

      <View className="px-6 pb-2 pt-2">
        <Center className="pb-2">
          <HStack className="items-center" space={4}>
            <Icon name="checkmark" size={16} color="#2E2419" />
            <Text className="text-[13px] font-semibold text-ink">No Payment Now</Text>
          </HStack>
        </Center>
        <Button action="plus" className="w-full" onPress={() => router.push("/(onboarding)/create-account")}>
          <ButtonText>Redeem 7 days for $0.00</ButtonText>
        </Button>
        <Center className="mt-2">
          <Text className="text-center text-[11px] text-muted">
            7 days free, then $39.99/yr ($3.33/mo) · Cancel anytime
          </Text>
        </Center>
      </View>
    </SafeAreaView>
  );
}
