import { Suspense } from 'react';
import { AdBrowser } from '@/components/ad-browser';
import { PageHeader, Spinner } from '@/components/ui';

export default function LibraryPage() {
  return (
    <>
      <PageHeader title="Ad Library" subtitle="Every ad you have collected, with filters, sorting and performance." />
      <Suspense fallback={<Spinner />}><AdBrowser mode="library" /></Suspense>
    </>
  );
}
