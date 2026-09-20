import { Text, View } from 'react-native';

/** Shared "not built yet" screen for the resource areas this pass deliberately doesn't implement. */
export function PlaceholderScreen({ label }: { label: string }): React.JSX.Element {
  return (
    <View className="flex-1 items-center justify-center bg-white px-6">
      <Text className="text-center text-neutral-500">{label} zatím není na mobilu k dispozici.</Text>
    </View>
  );
}
