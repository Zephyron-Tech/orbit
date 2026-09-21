import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';

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
        <TextInput className="rounded-lg border border-line px-3 py-2 text-ink" value={name} onChangeText={setName} />
        <View className="flex-row items-center justify-between">
          <Text className="text-sm text-ink-muted">Sdílená ve výchozím stavu</Text>
          <Switch value={isShared} onValueChange={setIsShared} trackColor={{ true: '#17647c' }} />
        </View>
        {error ? <Text className="text-sm text-critical">{error}</Text> : null}
        <View className="flex-row gap-2">
          <Pressable onPress={handleSave} disabled={updateCategory.isPending} className="flex-1 items-center rounded-lg bg-accent py-2 active:bg-accent-hover">
            <Text className="font-sans-medium text-accent-foreground">{updateCategory.isPending ? 'Ukládám…' : 'Uložit'}</Text>
          </Pressable>
          <Pressable onPress={() => setEditing(false)} className="flex-1 items-center rounded-lg border border-line py-2 active:bg-surface-subtle">
            <Text className="text-ink">Zrušit</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <Pressable onPress={() => setEditing(true)} className="flex-row items-center justify-between border-b border-line bg-surface px-4 py-3 active:bg-surface-subtle">
      <View className="flex-1">
        <Text className={category.isActive ? 'font-sans-medium text-ink' : 'font-sans-medium text-ink-faint'}>{category.name}</Text>
        <Text className="text-xs text-ink-muted">{category.transactionCount} transakcí{category.defaultIsShared ? ' · sdílená' : ''}</Text>
      </View>
      <Pressable onPress={handleToggleActive} className="rounded-full border border-line px-3 py-1 active:bg-surface-subtle">
        <Text className="text-xs text-ink-muted">{category.isActive ? 'Deaktivovat' : 'Aktivovat'}</Text>
      </Pressable>
    </Pressable>
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
        <TextInput className="rounded-lg border border-line px-3 py-2 text-ink" placeholder="Název" placeholderTextColor="#667570" value={newName} onChangeText={setNewName} />
        <View className="flex-row items-center justify-between">
          <Text className="text-sm text-ink-muted">Sdílená ve výchozím stavu</Text>
          <Switch value={newShared} onValueChange={setNewShared} trackColor={{ true: '#17647c' }} />
        </View>
        {createError ? <Text className="text-sm text-critical">{createError}</Text> : null}
        <Pressable onPress={handleCreate} disabled={createCategory.isPending || newName.trim().length === 0} className="items-center rounded-lg bg-accent py-2.5 active:bg-accent-hover">
          <Text className="font-sans-medium text-accent-foreground">{createCategory.isPending ? 'Vytvářím…' : 'Vytvořit'}</Text>
        </Pressable>
      </View>

      {data.categories.map((category) => (
        <CategoryRow key={category.id} category={category} />
      ))}
    </ScrollView>
  );
}
