import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { useChangeEmail, useChangePassword, useSettings, useUpdateReportingStartMonth } from '../../../hooks/use-settings';
import { useAuth } from '../../../lib/auth-context';

export default function SettingsScreen(): React.JSX.Element {
  const { user } = useAuth();
  const { data, isPending, isError, error } = useSettings();
  const changeEmail = useChangeEmail();
  const changePassword = useChangePassword();
  const updateReportingStartMonth = useUpdateReportingStartMonth();

  const [email, setEmail] = useState(user?.email ?? '');
  const [emailMessage, setEmailMessage] = useState<string | null>(null);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null);

  useEffect(() => {
    if (user?.email) setEmail(user.email);
  }, [user?.email]);

  function handleSaveEmail(): void {
    setEmailMessage(null);
    changeEmail.mutate(email, {
      onSuccess: () => setEmailMessage('E-mail byl změněn.'),
      onError: (mutationError) => setEmailMessage(mutationError instanceof Error ? mutationError.message : 'Nepodařilo se uložit'),
    });
  }

  function handleSavePassword(): void {
    setPasswordMessage(null);
    changePassword.mutate(
      { currentPassword, newPassword },
      {
        onSuccess: () => {
          setPasswordMessage('Heslo bylo změněno.');
          setCurrentPassword('');
          setNewPassword('');
        },
        onError: (mutationError) => setPasswordMessage(mutationError instanceof Error ? mutationError.message : 'Nepodařilo se uložit'),
      },
    );
  }

  return (
    <ScrollView className="flex-1 bg-white" contentContainerClassName="gap-6 p-4">
      <View className="gap-2">
        <Text className="text-sm font-medium text-neutral-500">E-mail</Text>
        <TextInput
          className="rounded-lg border border-neutral-300 px-3 py-2"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
        />
        {emailMessage ? <Text className={changeEmail.isError ? 'text-sm text-red-600' : 'text-sm text-emerald-600'}>{emailMessage}</Text> : null}
        <Pressable onPress={handleSaveEmail} disabled={changeEmail.isPending} className="items-center rounded-lg bg-neutral-900 py-2.5">
          <Text className="font-medium text-white">{changeEmail.isPending ? 'Ukládám…' : 'Uložit e-mail'}</Text>
        </Pressable>
      </View>

      <View className="gap-2 border-t border-neutral-100 pt-6">
        <Text className="text-sm font-medium text-neutral-500">Změna hesla</Text>
        <TextInput
          className="rounded-lg border border-neutral-300 px-3 py-2"
          placeholder="Současné heslo"
          secureTextEntry
          value={currentPassword}
          onChangeText={setCurrentPassword}
        />
        <TextInput
          className="rounded-lg border border-neutral-300 px-3 py-2"
          placeholder="Nové heslo (min. 10 znaků)"
          secureTextEntry
          value={newPassword}
          onChangeText={setNewPassword}
        />
        {passwordMessage ? <Text className={changePassword.isError ? 'text-sm text-red-600' : 'text-sm text-emerald-600'}>{passwordMessage}</Text> : null}
        <Pressable onPress={handleSavePassword} disabled={changePassword.isPending} className="items-center rounded-lg bg-neutral-900 py-2.5">
          <Text className="font-medium text-white">{changePassword.isPending ? 'Ukládám…' : 'Změnit heslo'}</Text>
        </Pressable>
      </View>

      <View className="gap-2 border-t border-neutral-100 pt-6">
        <Text className="text-sm font-medium text-neutral-500">Počáteční měsíc reportování</Text>
        {isPending ? (
          <ActivityIndicator />
        ) : isError ? (
          <Text className="text-sm text-red-600">{error instanceof Error ? error.message : 'Nepodařilo se načíst'}</Text>
        ) : (
          <View className="flex-row flex-wrap gap-2">
            {data.availableMonths.slice(0, 12).map((month) => (
              <Pressable
                key={month}
                onPress={() => updateReportingStartMonth.mutate(month)}
                className={`rounded-full border px-3 py-1.5 ${data.reportingStartMonth === month ? 'border-neutral-900 bg-neutral-900' : 'border-neutral-300'}`}
              >
                <Text className={data.reportingStartMonth === month ? 'text-white' : 'text-neutral-700'}>{month}</Text>
              </Pressable>
            ))}
          </View>
        )}
      </View>
    </ScrollView>
  );
}
