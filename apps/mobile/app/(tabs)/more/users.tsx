import { EnvelopeSimpleIcon, LinkSimpleIcon, TrashIcon, UserCircleIcon } from 'phosphor-react-native';
import { useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';

import { Badge } from '../../../components/badge';
import { Button } from '../../../components/button';
import { Switch } from '../../../components/switch';
import { SwipeableRow } from '../../../components/swipeable-row';
import { TextField } from '../../../components/text-field';
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
        <Switch value={user.isActive} disabled={saving} onValueChange={(value) => onSave({ ...user, isActive: value })} />
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

  function handleRevoke(invite: { id: string; email: string }): void {
    Alert.alert('Zrušit pozvánku?', invite.email, [
      { text: 'Zrušit', style: 'cancel' },
      { text: 'Zrušit pozvánku', style: 'destructive', onPress: () => revokeInvite.mutate(invite.id) },
    ]);
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
    <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <ScrollView className="flex-1 bg-canvas">
      <Text className="px-4 pb-2 pt-4 font-sans-semibold text-base text-ink">Členové</Text>
      {data.users.map((user) => (
        <UserRow key={user.id} user={user} isOwner={isOwner} onSave={handleUpdate} saving={updateUser.isPending} />
      ))}

      {isOwner ? (
        <>
          <Text className="px-4 pb-2 pt-6 font-sans-semibold text-base text-ink">Pozvat člena</Text>
          <View className="gap-2 px-4">
            <TextField
              variant="email"
              placeholder="E-mail"
              value={inviteEmail}
              onChangeText={setInviteEmail}
              returnKeyType="send"
              onSubmitEditing={handleCreateInvite}
            />
            {inviteMessage ? <Text className={createInvite.isError ? 'text-sm text-critical' : 'text-sm text-positive'}>{inviteMessage}</Text> : null}
            <Button variant="primary" icon={LinkSimpleIcon} loading={createInvite.isPending} disabled={!inviteEmail.trim()} onPress={handleCreateInvite}>
              Vytvořit pozvánku
            </Button>
          </View>

          <Text className="px-4 pb-2 pt-6 font-sans-semibold text-base text-ink">Otevřené pozvánky</Text>
          {openInvites.length ? (
            openInvites.map((invite) => (
              <SwipeableRow key={invite.id} actionLabel="Zrušit" actionIcon={TrashIcon} actionTone="critical" onAction={() => handleRevoke(invite)}>
                <View className="flex-row items-center gap-3 border-b border-line bg-surface px-4 py-3">
                  <View className="size-10 items-center justify-center rounded-xl bg-accent-soft">
                    <EnvelopeSimpleIcon color="#17647c" size={18} weight="regular" />
                  </View>
                  <Text className="flex-1 pr-3 text-ink" numberOfLines={1}>
                    {invite.email}
                  </Text>
                </View>
              </SwipeableRow>
            ))
          ) : (
            <Text className="px-4 pb-4 text-ink-muted">Žádné otevřené pozvánky.</Text>
          )}
        </>
      ) : null}
    </ScrollView>
    </KeyboardAvoidingView>
  );
}
