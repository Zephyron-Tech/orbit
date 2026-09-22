import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';

export type PushPermissionStatus = 'granted' | 'denied' | 'undetermined';

/** Push tokens don't work on simulators/emulators — guard before calling anything else here. */
export function isPushAvailable(): boolean {
  return Device.isDevice;
}

/**
 * Checks the current permission first and only prompts if it's genuinely
 * undetermined — same "don't re-prompt a user who already decided" shape
 * lib/biometric-auth.ts uses for Face ID.
 */
export async function requestPushPermission(): Promise<PushPermissionStatus> {
  const existing = await Notifications.getPermissionsAsync();
  if (existing.status === 'granted') return 'granted';

  const requested = await Notifications.requestPermissionsAsync({
    ios: { allowAlert: true, allowBadge: true, allowSound: true },
  });
  return requested.status;
}

/**
 * Resolves the Expo push token for this device. Never throws — a push-token
 * failure (denied permission, simulator, offline) must never block sign-in,
 * since this is called from auth-context.tsx's completeSignIn.
 */
export async function getExpoPushToken(): Promise<string | null> {
  if (!isPushAvailable()) return null;

  try {
    const permission = await requestPushPermission();
    if (permission !== 'granted') return null;

    const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
    const token = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    return token.data;
  } catch {
    return null;
  }
}

/**
 * Fire-and-forget registration, called once per successful sign-in.
 * Logs the token for now — Step 2 will POST it to the backend instead.
 */
export async function registerPushToken(): Promise<void> {
  try {
    const token = await getExpoPushToken();
    if (token) {
      // Placeholder until the Step 2 backend endpoint exists.
      console.log('[push] Expo push token:', token);
    }
  } catch {
    // Never let a notifications failure affect sign-in.
  }
}
