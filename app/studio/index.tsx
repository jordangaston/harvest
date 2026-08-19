import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Backdrop } from "../../components/recime/Backdrop";
import { ScrollView, VStack, Text, Pressable, Heading } from "../../components/ui";
import { studies } from "../../design/registry";
import type { Study } from "../../design/types";

function groupStudies(all: Study[]): [string, Study[]][] {
  const groups: Record<string, Study[]> = {};
  for (const study of all) {
    const key = study.group ?? "Ungrouped";
    (groups[key] ??= []).push(study);
  }
  return Object.entries(groups);
}

export default function StudioList() {
  const router = useRouter();
  if (!__DEV__) return null;

  return (
    <>
      <Backdrop />
      <SafeAreaView style={{ flex: 1 }}>
        <ScrollView className="flex-1 px-5" contentContainerStyle={{ paddingVertical: 24, gap: 24 }}>
          <Heading className="text-2xl font-bold text-ink">Design Studio</Heading>
          {groupStudies(studies).map(([group, items]) => (
            <VStack key={group} space={10}>
              <Text className="text-xs font-bold uppercase tracking-wide text-muted">{group}</Text>
              {items.map((study) => (
                <Pressable
                  key={study.name}
                  onPress={() => router.push(`/studio/${study.name}`)}
                  className="rounded-2xl border border-hairline bg-card px-4 py-4"
                >
                  <Text className="text-base font-bold text-ink">{study.name}</Text>
                </Pressable>
              ))}
            </VStack>
          ))}
        </ScrollView>
      </SafeAreaView>
    </>
  );
}
