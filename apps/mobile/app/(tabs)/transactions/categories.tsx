import { CheckCircleIcon, XCircleIcon } from 'phosphor-react-native';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';

import { Button } from '../../../components/button';
import { Switch } from '../../../components/switch';
import { SwipeableRow } from '../../../components/swipeable-row';
import { TextField } from '../../../components/text-field';
import { useCreateCategory, useTransactionsList, useUpdateCategory } from '../../../hooks/use-transactions';
import type { TransactionCategory } from '../../../lib/response-types';

function CategoryRow({ category }: { category: TransactionCategory }): React.JSX.Element {
  const updateCategory = useUpdateCategory();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(category.name);
  const [isShared, setIsShared] = useState(category.defaultIsShared);
  const [error, setError] = useState<string | null>(null);

  function handleSave(): void {
    setError(null);
    updateCategory.mutate(
      { id: category.id, name, isShared, isActive: category.isActive },
      { onSuccess: () => setEditing(false), onError: (e) => setError(e instanceof Error ? e.message : 'Nepodařilo se uložit') },
    );
  }

  function handleToggleActive(): void {
    updateCategory.mutate({ id: category.id, name: category.name, isShared: category.defaultIsShared, isActive: !category.isActive });
  }

  if (editing) {
    return (
      <View className="gap-2 border-b border-line bg-surface px-4 py-3">
        <TextField value={name} onChangeText={setName} returnKeyType="done" onSubmitEditing={handleSave} />
        <View className="flex-row items-center justify-between">
          <Text className="text-sm text-ink-muted">Sdílená ve výchozím stavu</Text>
          <Switch value={isShared} onValueChange={setIsShared} />
        </View>
        {error ? <Text className="text-sm text-critical">{error}</Text> : null}
        <View className="flex-row gap-2">
          <Button variant="primary" className="flex-1" loading={updateCategory.isPending} onPress={handleSave}>
            Uložit
          </Button>
          <Button variant="secondary" className="flex-1" onPress={() => setEditing(false)}>
            Zrušit
          </Button>
        </View>
      </View>
    );
  }

  return (
    <SwipeableRow
      actionLabel={category.isActive ? 'Deaktivovat' : 'Aktivovat'}
      actionIcon={category.isActive ? XCircleIcon : CheckCircleIcon}
      actionTone={category.isActive ? 'critical' : 'accent'}
      onAction={handleToggleActive}
    >
      <Pressable onPress={() => setEditing(true)} className="flex-row items-center justify-between border-b border-line bg-surface px-4 py-3 active:bg-surface-subtle">
        <View className="flex-1">
          <Text className={category.isActive ? 'font-sans-medium text-ink' : 'font-sans-medium text-ink-faint'}>{category.name}</Text>
          <Text className="text-xs text-ink-muted">{category.transactionCount} transakcí{category.defaultIsShared ? ' · sdílená' : ''}</Text>
        </View>
      </Pressable>
    </SwipeableRow>
  );
}

export default function CategoriesScreen(): React.JSX.Element {
  const { data, isPending, isError } = useTransactionsList({});
  const createCategory = useCreateCategory();
  const [newName, setNewName] = useState('');
  const [newShared, setNewShared] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  function handleCreate(): void {
    setCreateError(null);
    createCategory.mutate(
      { name: newName, isShared: newShared },
      { onSuccess: () => { setNewName(''); setNewShared(false); }, onError: (e) => setCreateError(e instanceof Error ? e.message : 'Nepodařilo se vytvořit') },
    );
  }

  if (isPending) {
    return (
      <View className="flex-1 items-center justify-center bg-canvas">
        <ActivityIndicator color="#17647c" />
      </View>
    );
  }

  if (isError || !data) {
    return (
      <View className="flex-1 items-center justify-center bg-canvas px-6">
        <Text className="text-center text-critical">Kategorie se nepodařilo načíst</Text>
      </View>
    );
  }

  return (
    <ScrollView className="flex-1 bg-canvas">
      <View className="gap-2 border-b border-line bg-surface p-4">
        <Text className="font-sans-medium text-sm text-ink-muted">Nová kategorie</Text>
        <TextField placeholder="Název" value={newName} onChangeText={setNewName} returnKeyType="done" onSubmitEditing={handleCreate} />
        <View className="flex-row items-center justify-between">
          <Text className="text-sm text-ink-muted">Sdílená ve výchozím stavu</Text>
          <Switch value={newShared} onValueChange={setNewShared} />
        </View>
        {createError ? <Text className="text-sm text-critical">{createError}</Text> : null}
        <Button variant="primary" disabled={newName.trim().length === 0} loading={createCategory.isPending} onPress={handleCreate}>
          Vytvořit
        </Button>
      </View>

      {data.categories.map((category) => (
        <CategoryRow key={category.id} category={category} />
      ))}
    </ScrollView>
  );
}
