import { Suspense } from 'react';
import { AdBrowser } from '@/components/ad-browser';
import { PageHeader, Spinner } from '@/components/ui';

export default function SearchPage() {
  return (
    <>
      <PageHeader title="Ad Search" subtitle="Search collected ads instantly, or trigger a new collection from Meta." />
      <Suspense fallback={<Spinner />}><AdBrowser mode="search" /></Suspense>
    </>
  );
}
