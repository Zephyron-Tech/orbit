import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { Button } from '../../components/button';
import { TextField } from '../../components/text-field';
import { useAuth } from '../../lib/auth-context';

export default function LoginScreen(): React.JSX.Element {
  const router = useRouter();
  const { login } = useAuth();
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
    router.replace('/(tabs)/dashboard');
  }

  return (
    <View className="flex-1 items-center justify-center bg-canvas px-6">
      <View className="mb-8 size-14 items-center justify-center rounded-2xl bg-accent">
        <Text className="text-2xl font-sans-bold text-accent-foreground">O</Text>
      </View>
      <Text className="mb-8 text-2xl font-sans-semibold text-ink">Orbit</Text>

      <TextField
        testID="login-email"
        variant="email"
        className="mb-3 w-full"
        placeholder="E-mail"
        value={email}
        onChangeText={setEmail}
        returnKeyType="next"
      />
      <TextField
        testID="login-password"
        className="mb-4 w-full"
        placeholder="Heslo"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
        returnKeyType="go"
        onSubmitEditing={() => void handleSubmit()}
      />

      {error ? <Text className="mb-3 text-sm text-critical">{error}</Text> : null}

      <Button testID="login-submit" variant="primary" loading={pending} onPress={() => void handleSubmit()} className="w-full">
        Přihlásit se
      </Button>
    </View>
  );
}
