import React from "react";
import { View } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { OnboardingScreen } from "../../components/recime/OnboardingScreen";
import { VStack, HStack, Text, Heading, Input, Pressable } from "../../components/ui";
import { signIn, sendOtp } from "../../lib/api/auth";

const RESEND_COOLDOWN = 30;

// Sign-in only: a returning user (welcome → "Sign in") verifies their phone and
// resumes their account. New users onboard anonymously — no code step there.
export default function VerifyCode() {
  const router = useRouter();
  const { phone } = useLocalSearchParams<{ phone?: string }>();
  const [code, setCode] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [cooldown, setCooldown] = React.useState(RESEND_COOLDOWN);

  React.useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const submit = async (value: string) => {
    if (busy || value.length !== 6 || !phone) return;
    setBusy(true);
    setError(null);
    try {
      await signIn(phone, value);
      router.replace("/(app)/recipes");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      setError(msg === "INVALID_OTP" ? "That code isn't right. Try again." : "Something went wrong. Try again.");
      setCode("");
      setBusy(false);
    }
  };

  const onChange = (text: string) => {
    const digits = text.replace(/[^\d]/g, "").slice(0, 6);
    setCode(digits);
    if (digits.length === 6) submit(digits);
  };

  const resend = async () => {
    if (cooldown > 0 || !phone) return;
    setError(null);
    try {
      await sendOtp(phone);
      setCooldown(RESEND_COOLDOWN);
    } catch {
      setError("Couldn't resend the code. Try again in a moment.");
    }
  };

  return (
    <OnboardingScreen
      progress={0.94}
      ctaLabel={busy ? "Verifying…" : "Verify"}
      ctaDisabled={code.length !== 6 || busy}
      onCta={() => submit(code)}
    >
      <View>
        <Heading className="text-2xl">Enter your code</Heading>
        <Text className="mt-2 text-muted">We texted a 6-digit code to {phone}.</Text>
      </View>

      <VStack className="mt-6" space={12}>
        <Input
          value={code}
          onChangeText={onChange}
          placeholder="123456"
          keyboardType="number-pad"
          autoComplete="sms-otp"
          textContentType="oneTimeCode"
          autoFocus
          maxLength={6}
          className="text-center text-xl tracking-[8px]"
        />
        {error ? <Text className="text-sm text-error">{error}</Text> : null}

        <HStack className="justify-center">
          <Pressable onPress={resend} disabled={cooldown > 0}>
            <Text className={cooldown > 0 ? "text-muted" : "text-brand font-semibold"}>
              {cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"}
            </Text>
          </Pressable>
        </HStack>
      </VStack>
    </OnboardingScreen>
  );
}
