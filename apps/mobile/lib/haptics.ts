import * as Haptics from 'expo-haptics';

/**
 * Thin wrapper around expo-haptics so call sites never import the raw
 * module — keeps the actual feedback tuning (which impact style maps to
 * which UI action) in one place.
 */
export const haptics = {
  tapLight(): void {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  },
  tapMedium(): void {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  },
  toggle(): void {
    void Haptics.selectionAsync();
  },
  notifySuccess(): void {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  },
  notifyError(): void {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
  },
};
