'use client';

import FloatingDock from './FloatingDock';

import { NotificationProvider } from './NotificationProvider';

export default function ClientShell({ children }: { children: React.ReactNode }) {
  return (
    <NotificationProvider>
      {children}
      <FloatingDock />
    </NotificationProvider>
  );
}
