import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { apiClient, logout } from '../lib/api-client';

interface SessionUser {
  id: string;
  email: string;
  name: string | null;
  role: string;
}

export function SessionScreen({ onLoggedOut }: { onLoggedOut: () => void }): React.JSX.Element {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadSession(): Promise<void> {
      try {
        const response = await apiClient.auth.session.$get();
        if (!response.ok) throw new Error('Session request failed');
        const body = await response.json();
        if (!cancelled) setUser(body.user);
      } catch {
        if (!cancelled) setError('Session se nepodařilo načíst');
      }
    }

    void loadSession();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleLogout(): Promise<void> {
    await logout();
    onLoggedOut();
  }

  return (
    <View className="flex-1 items-center justify-center bg-white px-6">
      {error ? (
        <Text className="text-sm text-red-600">{error}</Text>
      ) : user ? (
        <View className="w-full items-center">
          <Text className="mb-2 text-xl font-semibold text-neutral-900">Přihlášen jako</Text>
          <Text testID="session-email" className="mb-1 text-base text-neutral-700">
            {user.email}
          </Text>
          <Text className="mb-8 text-sm text-neutral-500">{user.role}</Text>
          <Pressable onPress={() => void handleLogout()} className="w-full items-center rounded-lg bg-neutral-200 py-3">
            <Text className="font-medium text-neutral-900">Odhlásit se</Text>
          </Pressable>
        </View>
      ) : (
        <ActivityIndicator />
      )}
    </View>
  );
}
