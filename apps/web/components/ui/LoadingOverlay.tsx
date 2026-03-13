'use client';

import { useAppStore } from '@/store';

export default function LoadingOverlay() {
  const isLoading = useAppStore(s => s.isLoading);
  return (
    <div className={`loading-overlay${isLoading ? ' show' : ''}`}>
      <div className="loading-spinner" />
    </div>
  );
}
