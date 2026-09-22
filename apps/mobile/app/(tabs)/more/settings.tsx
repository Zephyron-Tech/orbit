import { CalendarBlankIcon, EnvelopeSimpleIcon, FingerprintIcon, LockKeyIcon } from 'phosphor-react-native';
import { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';

import { Button } from '../../../components/button';
import { Switch } from '../../../components/switch';
import { TextField } from '../../../components/text-field';
import { useChangeEmail, useChangePassword, useSettings, useUpdateReportingStartMonth } from '../../../hooks/use-settings';
import { useAuth } from '../../../lib/auth-context';
import { isBiometricAuthAvailable, isBiometricLockEnabled, promptBiometricUnlock, setBiometricLockEnabled } from '../../../lib/biometric-auth';
import { colors } from '../../../lib/colors';

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
    <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <ScrollView className="flex-1 bg-canvas" contentContainerClassName="gap-6 p-4">
      <View className="gap-2 rounded-xl border border-line bg-surface p-4">
        <SectionHeading icon={<EnvelopeSimpleIcon color="#5d6c68" size={16} weight="regular" />} title="E-mail" />
        <TextField variant="email" value={email} onChangeText={setEmail} returnKeyType="done" onSubmitEditing={handleSaveEmail} />
        {emailMessage ? <Text className={changeEmail.isError ? 'text-sm text-critical' : 'text-sm text-positive'}>{emailMessage}</Text> : null}
        <Button variant="primary" loading={changeEmail.isPending} onPress={handleSaveEmail}>
          Uložit e-mail
        </Button>
      </View>

      <View className="gap-2 rounded-xl border border-line bg-surface p-4">
        <SectionHeading icon={<LockKeyIcon color="#5d6c68" size={16} weight="regular" />} title="Změna hesla" />
        <TextField
          placeholder="Současné heslo"
          secureTextEntry
          value={currentPassword}
          onChangeText={setCurrentPassword}
          returnKeyType="next"
        />
        <TextField
          placeholder="Nové heslo (min. 10 znaků)"
          secureTextEntry
          value={newPassword}
          onChangeText={setNewPassword}
          returnKeyType="done"
          onSubmitEditing={handleSavePassword}
        />
        {passwordMessage ? <Text className={changePassword.isError ? 'text-sm text-critical' : 'text-sm text-positive'}>{passwordMessage}</Text> : null}
        <Button variant="primary" loading={changePassword.isPending} onPress={handleSavePassword}>
          Změnit heslo
        </Button>
      </View>

      <View className="gap-2 rounded-xl border border-line bg-surface p-4">
        <SectionHeading icon={<CalendarBlankIcon color="#5d6c68" size={16} weight="regular" />} title="Počáteční měsíc reportování" />
        {isPending ? (
          <ActivityIndicator color={colors.accent} />
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
            <Switch value={biometricEnabled} onValueChange={(next) => void handleToggleBiometric(next)} />
          </View>
          <Text className="text-xs text-ink-faint">Appka bude při otevření vyžadovat biometrické ověření místo automatického přihlášení.</Text>
          {biometricMessage ? <Text className="text-sm text-critical">{biometricMessage}</Text> : null}
        </View>
      ) : null}
    </ScrollView>
    </KeyboardAvoidingView>
  );
}
