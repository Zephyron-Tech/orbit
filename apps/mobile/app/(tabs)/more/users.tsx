import { EnvelopeSimpleIcon, LinkSimpleIcon, UserCircleIcon } from 'phosphor-react-native';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';

import { Badge } from '../../../components/badge';
import { useCreateInvite, useInvitesList, useRevokeInvite, useUpdateHouseholdUser, useUsers } from '../../../hooks/use-users';
import type { HouseholdUserRow } from '../../../lib/response-types';

function UserRow({ user, isOwner, onSave, saving }: { user: HouseholdUserRow; isOwner: boolean; onSave: (input: HouseholdUserRow) => void; saving: boolean }): React.JSX.Element {
  return (
    <View className="flex-row items-start gap-3 border-b border-line bg-surface px-4 py-3">
      <View className="size-10 items-center justify-center rounded-xl bg-accent-soft">
        <UserCircleIcon color="#17647c" size={20} weight="fill" />
      </View>
      <View className="flex-1 pr-3">
        <View className="flex-row flex-wrap items-center gap-2">
          <Text className="font-sans-semibold text-ink" numberOfLines={1}>
            {user.name ?? user.email}
          </Text>
          {user.isCurrentUser ? <Badge tone="info">Vy</Badge> : null}
          <Badge>{user.role === 'OWNER' ? 'Vlastník' : 'Člen'}</Badge>
          {!user.isActive ? <Badge tone="danger">Deaktivovaný</Badge> : null}
        </View>
        <Text className="mt-1 text-xs text-ink-muted">{user.email}</Text>
      </View>
      {isOwner && !user.isCurrentUser ? (
        <Switch
          value={user.isActive}
          disabled={saving}
          onValueChange={(value) => onSave({ ...user, isActive: value })}
          trackColor={{ false: '#d8e0dd', true: '#17647c' }}
        />
      ) : null}
    </View>
  );
}

export default function UsersScreen(): React.JSX.Element {
  const { data, isPending, isError, error } = useUsers();
  const updateUser = useUpdateHouseholdUser();
  const isOwner = data?.isOwner ?? false;

  const invitesList = useInvitesList(isOwner);
  const createInvite = useCreateInvite();
  const revokeInvite = useRevokeInvite();

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteMessage, setInviteMessage] = useState<string | null>(null);

  function handleUpdate(input: HouseholdUserRow): void {
    updateUser.mutate(
      { id: input.id, name: input.name, email: input.email, role: input.role, isActive: input.isActive },
      { onError: (mutationError) => Alert.alert('Nepodařilo se uložit', mutationError instanceof Error ? mutationError.message : 'Zkuste to znovu.') },
    );
  }

  function handleCreateInvite(): void {
    setInviteMessage(null);
    createInvite.mutate(
      { email: inviteEmail.trim(), role: 'MEMBER' },
      {
        onSuccess: () => {
          setInviteMessage('Pozvánka byla vytvořena — odkaz otevřete ve webové appce.');
          setInviteEmail('');
        },
        onError: (mutationError) => setInviteMessage(mutationError instanceof Error ? mutationError.message : 'Pozvánku se nepodařilo vytvořit'),
      },
    );
  }

  if (isPending) {
    return (
      <View className="flex-1 items-center justify-center bg-canvas">
        <ActivityIndicator color="#17647c" />
      </View>
    );
  }

  if (isError) {
    return (
      <View className="flex-1 items-center justify-center bg-canvas px-6">
        <Text className="text-center text-critical">{error instanceof Error ? error.message : 'Domácnost se nepodařilo načíst'}</Text>
      </View>
    );
  }

  const openInvites = invitesList.data?.invites.filter((invite) => !invite.acceptedAt) ?? [];

  return (
    <ScrollView className="flex-1 bg-canvas">
      <Text className="px-4 pb-2 pt-4 font-sans-semibold text-base text-ink">Členové</Text>
      {data.users.map((user) => (
        <UserRow key={user.id} user={user} isOwner={isOwner} onSave={handleUpdate} saving={updateUser.isPending} />
      ))}

      {isOwner ? (
        <>
          <Text className="px-4 pb-2 pt-6 font-sans-semibold text-base text-ink">Pozvat člena</Text>
          <View className="gap-2 px-4">
            <TextInput
              className="rounded-lg border border-line bg-surface px-3 py-2 text-ink"
              placeholder="E-mail"
              placeholderTextColor="#667570"
              autoCapitalize="none"
              keyboardType="email-address"
              value={inviteEmail}
              onChangeText={setInviteEmail}
            />
            {inviteMessage ? <Text className={createInvite.isError ? 'text-sm text-critical' : 'text-sm text-positive'}>{inviteMessage}</Text> : null}
            <Pressable
              onPress={handleCreateInvite}
              disabled={createInvite.isPending || !inviteEmail.trim()}
              className="flex-row items-center justify-center gap-2 rounded-lg bg-accent py-2.5 active:bg-accent-hover"
            >
              <LinkSimpleIcon color="#f8fcfd" size={16} weight="bold" />
              <Text className="font-sans-medium text-accent-foreground">{createInvite.isPending ? 'Odesílám…' : 'Vytvořit pozvánku'}</Text>
            </Pressable>
          </View>

          <Text className="px-4 pb-2 pt-6 font-sans-semibold text-base text-ink">Otevřené pozvánky</Text>
          {openInvites.length ? (
            openInvites.map((invite) => (
              <View key={invite.id} className="flex-row items-center gap-3 border-b border-line bg-surface px-4 py-3">
                <View className="size-10 items-center justify-center rounded-xl bg-accent-soft">
                  <EnvelopeSimpleIcon color="#17647c" size={18} weight="regular" />
                </View>
                <Text className="flex-1 pr-3 text-ink" numberOfLines={1}>
                  {invite.email}
                </Text>
                <Pressable onPress={() => revokeInvite.mutate(invite.id)} disabled={revokeInvite.isPending} className="rounded-md bg-critical-soft px-2 py-1.5 active:opacity-70">
                  <Text className="text-xs font-sans-medium text-critical">Zrušit</Text>
                </Pressable>
              </View>
            ))
          ) : (
            <Text className="px-4 pb-4 text-ink-muted">Žádné otevřené pozvánky.</Text>
          )}
        </>
      ) : null}
    </ScrollView>
  );
}
