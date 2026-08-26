'use client';

import { signOut } from 'next-auth/react';

export function SignOutButton(): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={() => void signOut({ callbackUrl: '/signin' })}
      className="text-xs text-black/60 underline dark:text-white/60"
    >
      Odhlásit
    </button>
  );
}
