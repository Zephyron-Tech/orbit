import { useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';

import { login } from '../lib/api-client';

export function LoginScreen({ onLoggedIn }: { onLoggedIn: () => void }): React.JSX.Element {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(): Promise<void> {
    setPending(true);
    setError(null);

    const result = await login(email.trim(), password);

    if (!result.ok) {
      setError(result.error ?? 'Přihlášení se nezdařilo');
      setPending(false);
      return;
    }

    setPending(false);
    onLoggedIn();
  }

  return (
    <View className="flex-1 items-center justify-center bg-white px-6">
      <Text className="mb-8 text-2xl font-semibold text-neutral-900">Orbit</Text>

      <TextInput
        testID="login-email"
        className="mb-3 w-full rounded-lg border border-neutral-300 px-4 py-3 text-base"
        placeholder="E-mail"
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />
      <TextInput
        testID="login-password"
        className="mb-4 w-full rounded-lg border border-neutral-300 px-4 py-3 text-base"
        placeholder="Heslo"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />

      {error ? <Text className="mb-3 text-sm text-red-600">{error}</Text> : null}

      <Pressable
        testID="login-submit"
        onPress={() => void handleSubmit()}
        disabled={pending}
        className="w-full items-center rounded-lg bg-neutral-900 py-3"
      >
        {pending ? <ActivityIndicator color="#fff" /> : <Text className="font-medium text-white">Přihlásit se</Text>}
      </Pressable>
    </View>
  );
}
