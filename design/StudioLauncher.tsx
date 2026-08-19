import { useRouter } from "expo-router";
import { Pressable, Text } from "../components/ui";

/**
 * Dev-only floating entry point to the Design Studio. Mounted under __DEV__ in
 * the root layout — the studio has no link from any shipping screen, so this is
 * the sole way in, and it never renders in production.
 */
export function StudioLauncher() {
  const router = useRouter();
  return (
    <Pressable
      onPress={() => router.push("/studio")}
      className="absolute right-3 top-16 rounded-full border border-hairline bg-card px-3 py-1.5"
      style={{ opacity: 0.9 }}
    >
      <Text className="text-xs font-bold text-ink">🎞 Studio</Text>
    </Pressable>
  );
}
