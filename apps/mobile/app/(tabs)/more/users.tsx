import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';

import { useCreateInvite, useInvitesList, useRevokeInvite, useUpdateHouseholdUser, useUsers } from '../../../hooks/use-users';
import type { HouseholdUserRow } from '../../../lib/response-types';

function UserRow({ user, isOwner, onSave, saving }: { user: HouseholdUserRow; isOwner: boolean; onSave: (input: HouseholdUserRow) => void; saving: boolean }): React.JSX.Element {
  return (
    <View className="border-b border-neutral-100 px-4 py-3">
      <View className="flex-row items-center justify-between">
        <View className="flex-1 pr-3">
          <Text className="font-medium text-neutral-900" numberOfLines={1}>
            {user.name ?? user.email}
          </Text>
          <Text className="text-xs text-neutral-500">
            {user.email} · {user.role === 'OWNER' ? 'Vlastník' : 'Člen'}
            {user.isCurrentUser ? ' · vy' : ''}
          </Text>
        </View>
        {isOwner && !user.isCurrentUser ? (
          <Switch
            value={user.isActive}
            disabled={saving}
            onValueChange={(value) => onSave({ ...user, isActive: value })}
          />
        ) : (
          <Text className="text-xs text-neutral-500">{user.isActive ? 'Aktivní' : 'Neaktivní'}</Text>
        )}
      </View>
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
      <View className="flex-1 items-center justify-center bg-white">
        <ActivityIndicator />
      </View>
    );
  }

  if (isError) {
    return (
      <View className="flex-1 items-center justify-center bg-white px-6">
        <Text className="text-center text-red-600">{error instanceof Error ? error.message : 'Domácnost se nepodařilo načíst'}</Text>
      </View>
    );
  }

  return (
    <ScrollView className="flex-1 bg-white">
      <Text className="px-4 pb-2 pt-4 text-sm font-medium text-neutral-500">Členové</Text>
      {data.users.map((user) => (
        <UserRow key={user.id} user={user} isOwner={isOwner} onSave={handleUpdate} saving={updateUser.isPending} />
      ))}

      {isOwner ? (
        <>
          <Text className="px-4 pb-2 pt-6 text-sm font-medium text-neutral-500">Pozvat člena</Text>
          <View className="gap-2 px-4">
            <TextInput
              className="rounded-lg border border-neutral-300 px-3 py-2"
              placeholder="E-mail"
              autoCapitalize="none"
              keyboardType="email-address"
              value={inviteEmail}
              onChangeText={setInviteEmail}
            />
            {inviteMessage ? <Text className={createInvite.isError ? 'text-sm text-red-600' : 'text-sm text-emerald-600'}>{inviteMessage}</Text> : null}
            <Pressable onPress={handleCreateInvite} disabled={createInvite.isPending || !inviteEmail.trim()} className="items-center rounded-lg bg-neutral-900 py-2.5">
              <Text className="font-medium text-white">{createInvite.isPending ? 'Odesílám…' : 'Vytvořit pozvánku'}</Text>
            </Pressable>
          </View>

          <Text className="px-4 pb-2 pt-6 text-sm font-medium text-neutral-500">Otevřené pozvánky</Text>
          {invitesList.data?.invites.filter((invite) => !invite.acceptedAt).length ? (
            invitesList.data.invites
              .filter((invite) => !invite.acceptedAt)
              .map((invite) => (
                <View key={invite.id} className="flex-row items-center justify-between border-b border-neutral-100 px-4 py-3">
                  <Text className="flex-1 pr-3 text-neutral-900" numberOfLines={1}>
                    {invite.email}
                  </Text>
                  <Pressable onPress={() => revokeInvite.mutate(invite.id)} disabled={revokeInvite.isPending} className="rounded-md bg-neutral-100 px-2 py-1">
                    <Text className="text-xs text-red-600">Zrušit</Text>
                  </Pressable>
                </View>
              ))
          ) : (
            <Text className="px-4 pb-4 text-neutral-500">Žádné otevřené pozvánky.</Text>
          )}
        </>
      ) : null}
    </ScrollView>
  );
}
