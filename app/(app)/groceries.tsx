import React from "react";
import { View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Backdrop } from "../../components/recime/Backdrop";
import { Box, VStack, HStack, Center, Text, Heading, Pressable, Button, ButtonText, Input, Icon, Image } from "../../components/ui";

export default function Groceries() {
  const [addOpen, setAddOpen] = React.useState(false);
  const [storeOpen, setStoreOpen] = React.useState(false);
  const [store, setStore] = React.useState<"instacart" | "walmart" | null>(null);

  return (
    <SafeAreaView className="flex-1 bg-cream" edges={["top"]}>
      <Backdrop />
      <VStack className="px-5 pt-2" space={4}>
        <Heading className="text-2xl">Grocery List</Heading>
        <Text className="text-muted">0 items</Text>
      </VStack>

      <View className="px-5 pt-4">
        <Button action="light" variant="outline" onPress={() => setStoreOpen(true)}>
          <Text className="mr-2 text-base">🛒</Text>
          <Text className="text-base font-semibold text-ink">Order online</Text>
        </Button>
      </View>

      <Center className="flex-1 px-6">
        <Image
          source={require("../../assets/empty-groceries.png")}
          resizeMode="contain"
          className="mb-4 h-64 w-64"
        />
        <Text className="text-muted">No ingredients added</Text>
      </Center>

      <Pressable
        className="absolute bottom-6 right-6 h-14 w-14 items-center justify-center rounded-full bg-brand shadow-lg"
        onPress={() => setAddOpen(true)}
      >
        <Icon name="add" size={30} color="#fff" />
      </Pressable>

      {addOpen ? (
        <Pressable className="absolute inset-0 bg-black/30" onPress={() => setAddOpen(false)}>
          <View className="absolute inset-x-0 bottom-0">
            <Pressable onPress={() => {}}>
              <Box className="rounded-t-3xl bg-white px-5 pb-10 pt-6">
                <VStack space={16}>
                  <Text className="text-center text-base font-semibold text-ink">Add to Groceries</Text>
                  <Input placeholder="Type or paste multiple ingredients" />
                  <Button action="brand" className="w-full" onPress={() => setAddOpen(false)}>
                    <ButtonText>Done</ButtonText>
                  </Button>
                </VStack>
              </Box>
            </Pressable>
          </View>
        </Pressable>
      ) : null}

      {storeOpen ? (
        <Pressable className="absolute inset-0 bg-black/30" onPress={() => setStoreOpen(false)}>
          <View className="absolute inset-x-0 bottom-0">
            <Pressable onPress={() => {}}>
              <Box className="rounded-t-3xl bg-white px-5 pb-10 pt-6">
                <VStack space={12}>
                  <Text className="text-center text-base font-semibold text-ink">Choose store</Text>

                  <Pressable
                    className="flex-row items-center justify-between rounded-xl border border-hairline px-4 py-4"
                    onPress={() => setStore("instacart")}
                  >
                    <Text className="text-base font-semibold text-ink">Instacart</Text>
                    {store === "instacart" ? <Icon name="checkmark-circle" size={22} color="#A85E2B" /> : null}
                  </Pressable>

                  <Pressable
                    className="flex-row items-center justify-between rounded-xl border border-hairline px-4 py-4"
                    onPress={() => setStore("walmart")}
                  >
                    <Text className="text-base font-semibold text-ink">Walmart</Text>
                    {store === "walmart" ? <Icon name="checkmark-circle" size={22} color="#A85E2B" /> : null}
                  </Pressable>
                </VStack>
              </Box>
            </Pressable>
          </View>
        </Pressable>
      ) : null}
    </SafeAreaView>
  );
}
