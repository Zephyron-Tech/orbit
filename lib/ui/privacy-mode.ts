'use client';

import { useSyncExternalStore } from 'react';

const STORAGE_KEY = 'orbit-privacy-hidden';
const EVENT = 'orbit-privacy-change';

function getSnapshot(): boolean {
  return localStorage.getItem(STORAGE_KEY) === 'true';
}

function getServerSnapshot(): boolean {
  return false;
}

function subscribe(callback: () => void): () => void {
  const onStorage = (event: StorageEvent): void => {
    if (event.key !== STORAGE_KEY) return;
    callback();
  };
  window.addEventListener(EVENT, callback);
  window.addEventListener('storage', onStorage);

  return () => {
    window.removeEventListener(EVENT, callback);
    window.removeEventListener('storage', onStorage);
  };
}

export function usePrivacyMode(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function togglePrivacyMode(): void {
  const next = localStorage.getItem(STORAGE_KEY) !== 'true';
  localStorage.setItem(STORAGE_KEY, String(next));
  window.dispatchEvent(new Event(EVENT));
}
