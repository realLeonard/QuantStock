'use client';

import { useAppStore } from '@/store';

export default function Toast() {
  const toastMsg = useAppStore(s => s.toastMsg);
  return (
    <div className={`toast${toastMsg ? ' show' : ''}`}>
      {toastMsg}
    </div>
  );
}
