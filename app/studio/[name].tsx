import React from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams } from "expo-router";
import { Backdrop } from "../../components/recime/Backdrop";
import { ScrollView, VStack, Center, Text } from "../../components/ui";
import { Controls } from "../../design/Controls";
import { seedValues } from "../../design/controls.ts";
import { studies } from "../../design/registry";
import type { Study } from "../../design/types";

/** Holds the control values for one study; remounted per study so state resets. */
function StudioDetailBody({ study }: { study: Study }) {
  const [values, setValues] = React.useState(() => seedValues(study.controls));
  return (
    <ScrollView className="flex-1 px-5" contentContainerStyle={{ paddingVertical: 24, gap: 24 }}>
      <Text className="text-xs font-bold uppercase tracking-wide text-muted">{study.name}</Text>
      <Center>{study.render(values)}</Center>
      {study.controls?.length ? (
        <Controls specs={study.controls} values={values} onChange={setValues} />
      ) : null}
    </ScrollView>
  );
}

export default function StudioDetail() {
  const { name } = useLocalSearchParams<{ name: string }>();
  if (!__DEV__) return null;

  const study = studies.find((s) => s.name === name);

  return (
    <>
      <Backdrop />
      <SafeAreaView style={{ flex: 1 }}>
        {study ? (
          <StudioDetailBody key={study.name} study={study} />
        ) : (
          <Center className="flex-1 px-8">
            <VStack space={8} className="items-center">
              <Text className="text-lg font-bold text-ink">No study named “{name}”</Text>
              <Text className="text-center text-sm text-muted">Check the name in design/registry.ts.</Text>
            </VStack>
          </Center>
        )}
      </SafeAreaView>
    </>
  );
}
