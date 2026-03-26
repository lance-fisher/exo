'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from '@/lib/hooks';

export default function Home() {
  const router = useRouter();
  const { session, loading } = useSession();

  useEffect(() => {
    if (loading) return;
    if (session) {
      router.replace('/dashboard');
    } else {
      router.replace('/auth');
    }
  }, [session, loading, router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-accent-blue border-t-transparent" />
    </div>
  );
}
