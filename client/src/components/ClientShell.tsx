'use client';

import FloatingDock from './FloatingDock';

export default function ClientShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <FloatingDock />
    </>
  );
}
