import React from "react";
import { View } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { OnboardingScreen } from "../../components/recime/OnboardingScreen";
import { VStack, Text, Heading, Input } from "../../components/ui";
import { sendOtp } from "../../lib/api/auth";

/** US-default E.164: a leading "+" is respected for other countries (Q-01). */
function toE164(raw: string): string {
  const trimmed = raw.trim();
  const digits = trimmed.replace(/[^\d]/g, "");
  return trimmed.startsWith("+") ? `+${digits}` : `+1${digits}`;
}

export default function Phone() {
  const router = useRouter();
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  const [phone, setPhone] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const digits = phone.replace(/[^\d]/g, "");
  const ready = digits.length >= 10 && !busy;

  const submit = async () => {
    if (!ready) return;
    const e164 = toE164(phone);
    setError(null);
    setBusy(true);
    try {
      await sendOtp(e164);
      const q = `phone=${encodeURIComponent(e164)}${mode === "signin" ? "&mode=signin" : ""}`;
      router.push(`/(onboarding)/verify-code?${q}`);
    } catch {
      setError("We couldn't send a code to that number. Check it and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <OnboardingScreen
      progress={0.88}
      ctaLabel={busy ? "Sending…" : "Send code"}
      ctaDisabled={!ready}
      onCta={submit}
    >
      <View>
        <Heading className="text-2xl">What's your number?</Heading>
        <Text className="mt-2 text-muted">
          We'll text you a code to verify it. U.S. numbers by default — start with + for another country.
        </Text>
      </View>

      <VStack className="mt-6" space={8}>
        <Input
          value={phone}
          onChangeText={setPhone}
          placeholder="(555) 555-0123"
          keyboardType="phone-pad"
          autoComplete="tel"
          autoFocus
          returnKeyType="go"
          onSubmitEditing={submit}
        />
        {error ? <Text className="text-sm text-error">{error}</Text> : null}
      </VStack>
    </OnboardingScreen>
  );
}
