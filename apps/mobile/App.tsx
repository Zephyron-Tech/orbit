import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import './global.css';
import { LoginScreen } from './screens/login-screen';
import { SessionScreen } from './screens/session-screen';

export default function App(): React.JSX.Element {
  const [loggedIn, setLoggedIn] = useState(false);

  return (
    <SafeAreaProvider>
      {loggedIn ? <SessionScreen onLoggedOut={() => setLoggedIn(false)} /> : <LoginScreen onLoggedIn={() => setLoggedIn(true)} />}
      <StatusBar style="dark" />
    </SafeAreaProvider>
  );
}
