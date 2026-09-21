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
      <View className="gap-2 border-b border-neutral-100 px-4 py-3">
        <TextInput className="rounded-lg border border-neutral-300 px-3 py-2" value={name} onChangeText={setName} />
        <View className="flex-row items-center justify-between">
          <Text className="text-sm text-neutral-500">Sdílená ve výchozím stavu</Text>
          <Switch value={isShared} onValueChange={setIsShared} />
        </View>
        {error ? <Text className="text-sm text-red-600">{error}</Text> : null}
        <View className="flex-row gap-2">
          <Pressable onPress={handleSave} disabled={updateCategory.isPending} className="flex-1 items-center rounded-lg bg-neutral-900 py-2">
            <Text className="font-medium text-white">{updateCategory.isPending ? 'Ukládám…' : 'Uložit'}</Text>
          </Pressable>
          <Pressable onPress={() => setEditing(false)} className="flex-1 items-center rounded-lg border border-neutral-300 py-2">
            <Text className="text-neutral-900">Zrušit</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <Pressable onPress={() => setEditing(true)} className="flex-row items-center justify-between border-b border-neutral-100 px-4 py-3">
      <View className="flex-1">
        <Text className={category.isActive ? 'font-medium text-neutral-900' : 'font-medium text-neutral-400'}>{category.name}</Text>
        <Text className="text-xs text-neutral-500">{category.transactionCount} transakcí{category.defaultIsShared ? ' · sdílená' : ''}</Text>
      </View>
      <Pressable onPress={handleToggleActive} className="rounded-full border border-neutral-300 px-3 py-1">
        <Text className="text-xs text-neutral-700">{category.isActive ? 'Deaktivovat' : 'Aktivovat'}</Text>
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
      <View className="flex-1 items-center justify-center bg-white">
        <ActivityIndicator />
      </View>
    );
  }

  if (isError || !data) {
    return (
      <View className="flex-1 items-center justify-center bg-white px-6">
        <Text className="text-center text-red-600">Kategorie se nepodařilo načíst</Text>
      </View>
    );
  }

  return (
    <ScrollView className="flex-1 bg-white">
      <View className="gap-2 border-b border-neutral-100 p-4">
        <Text className="text-sm font-medium text-neutral-500">Nová kategorie</Text>
        <TextInput className="rounded-lg border border-neutral-300 px-3 py-2" placeholder="Název" value={newName} onChangeText={setNewName} />
        <View className="flex-row items-center justify-between">
          <Text className="text-sm text-neutral-500">Sdílená ve výchozím stavu</Text>
          <Switch value={newShared} onValueChange={setNewShared} />
        </View>
        {createError ? <Text className="text-sm text-red-600">{createError}</Text> : null}
        <Pressable onPress={handleCreate} disabled={createCategory.isPending || newName.trim().length === 0} className="items-center rounded-lg bg-neutral-900 py-2.5">
          <Text className="font-medium text-white">{createCategory.isPending ? 'Vytvářím…' : 'Vytvořit'}</Text>
        </Pressable>
      </View>

      {data.categories.map((category) => (
        <CategoryRow key={category.id} category={category} />
      ))}
    </ScrollView>
  );
}
