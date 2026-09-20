import { Text, View } from 'react-native';

// Placeholder — settlement is a separate implementation pass, not this one.
// Present just enough that the tab doesn't 404.
export default function SettlementScreen(): React.JSX.Element {
  return (
    <View className="flex-1 items-center justify-center bg-white px-6">
      <Text className="text-center text-neutral-500">Vyrovnání zatím není na mobilu k dispozici.</Text>
    </View>
  );
}
