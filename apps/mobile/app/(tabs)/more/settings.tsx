import { CalendarBlankIcon, EnvelopeSimpleIcon, FingerprintIcon, LockKeyIcon } from 'phosphor-react-native';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';

import { useChangeEmail, useChangePassword, useSettings, useUpdateReportingStartMonth } from '../../../hooks/use-settings';
import { useAuth } from '../../../lib/auth-context';
import { isBiometricAuthAvailable, isBiometricLockEnabled, promptBiometricUnlock, setBiometricLockEnabled } from '../../../lib/biometric-auth';

function SectionHeading({ icon, title }: { icon: React.ReactNode; title: string }): React.JSX.Element {
  return (
    <View className="flex-row items-center gap-2">
      {icon}
      <Text className="font-sans-semibold text-base text-ink">{title}</Text>
    </View>
  );
}

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

  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometricEnabled, setBiometricEnabledState] = useState(false);
  const [biometricMessage, setBiometricMessage] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const [available, enabled] = await Promise.all([isBiometricAuthAvailable(), isBiometricLockEnabled()]);
      setBiometricAvailable(available);
      setBiometricEnabledState(enabled);
    })();
  }, []);

  async function handleToggleBiometric(next: boolean): Promise<void> {
    setBiometricMessage(null);

    // Confirm the sensor actually works before relying on it as the app's
    // lock screen — turning this on with a broken prompt would otherwise
    // lock the user out of their own app on next launch.
    if (next) {
      const result = await promptBiometricUnlock();
      if (!result.ok) {
        setBiometricMessage(result.error ?? 'Ověření se nezdařilo, zkuste to znovu');
        return;
      }
    }

    await setBiometricLockEnabled(next);
    setBiometricEnabledState(next);
  }

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
    <ScrollView className="flex-1 bg-canvas" contentContainerClassName="gap-6 p-4">
      <View className="gap-2 rounded-xl border border-line bg-surface p-4">
        <SectionHeading icon={<EnvelopeSimpleIcon color="#5d6c68" size={16} weight="regular" />} title="E-mail" />
        <TextInput
          className="rounded-lg border border-line bg-canvas px-3 py-2 text-ink"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
        />
        {emailMessage ? <Text className={changeEmail.isError ? 'text-sm text-critical' : 'text-sm text-positive'}>{emailMessage}</Text> : null}
        <Pressable onPress={handleSaveEmail} disabled={changeEmail.isPending} className="items-center rounded-lg bg-accent py-2.5 active:bg-accent-hover">
          <Text className="font-sans-medium text-accent-foreground">{changeEmail.isPending ? 'Ukládám…' : 'Uložit e-mail'}</Text>
        </Pressable>
      </View>

      <View className="gap-2 rounded-xl border border-line bg-surface p-4">
        <SectionHeading icon={<LockKeyIcon color="#5d6c68" size={16} weight="regular" />} title="Změna hesla" />
        <TextInput
          className="rounded-lg border border-line bg-canvas px-3 py-2 text-ink"
          placeholder="Současné heslo"
          placeholderTextColor="#667570"
          secureTextEntry
          value={currentPassword}
          onChangeText={setCurrentPassword}
        />
        <TextInput
          className="rounded-lg border border-line bg-canvas px-3 py-2 text-ink"
          placeholder="Nové heslo (min. 10 znaků)"
          placeholderTextColor="#667570"
          secureTextEntry
          value={newPassword}
          onChangeText={setNewPassword}
        />
        {passwordMessage ? <Text className={changePassword.isError ? 'text-sm text-critical' : 'text-sm text-positive'}>{passwordMessage}</Text> : null}
        <Pressable onPress={handleSavePassword} disabled={changePassword.isPending} className="items-center rounded-lg bg-accent py-2.5 active:bg-accent-hover">
          <Text className="font-sans-medium text-accent-foreground">{changePassword.isPending ? 'Ukládám…' : 'Změnit heslo'}</Text>
        </Pressable>
      </View>

      <View className="gap-2 rounded-xl border border-line bg-surface p-4">
        <SectionHeading icon={<CalendarBlankIcon color="#5d6c68" size={16} weight="regular" />} title="Počáteční měsíc reportování" />
        {isPending ? (
          <ActivityIndicator color="#17647c" />
        ) : isError ? (
          <Text className="text-sm text-critical">{error instanceof Error ? error.message : 'Nepodařilo se načíst'}</Text>
        ) : (
          <View className="flex-row flex-wrap gap-2">
            {data.availableMonths.slice(0, 12).map((month) => (
              <Pressable
                key={month}
                onPress={() => updateReportingStartMonth.mutate(month)}
                className={`rounded-full border px-3 py-1.5 active:opacity-80 ${data.reportingStartMonth === month ? 'border-accent bg-accent-soft' : 'border-line bg-canvas'}`}
              >
                <Text className={data.reportingStartMonth === month ? 'font-sans-medium text-accent' : 'text-ink-muted'}>{month}</Text>
              </Pressable>
            ))}
          </View>
        )}
      </View>

      {biometricAvailable ? (
        <View className="gap-2 rounded-xl border border-line bg-surface p-4">
          <View className="flex-row items-center justify-between">
            <SectionHeading icon={<FingerprintIcon color="#5d6c68" size={16} weight="regular" />} title="Face ID / Touch ID" />
            <Switch value={biometricEnabled} onValueChange={(next) => void handleToggleBiometric(next)} trackColor={{ false: '#d8e0dd', true: '#17647c' }} />
          </View>
          <Text className="text-xs text-ink-faint">Appka bude při otevření vyžadovat biometrické ověření místo automatického přihlášení.</Text>
          {biometricMessage ? <Text className="text-sm text-critical">{biometricMessage}</Text> : null}
        </View>
      ) : null}
    </ScrollView>
  );
}
