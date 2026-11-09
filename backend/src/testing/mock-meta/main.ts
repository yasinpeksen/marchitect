import { createMockMetaServer } from './mock-meta-server';

const port = Number(process.env.MOCK_META_PORT ?? 4010);
const publicUrl = process.env.MOCK_META_PUBLIC_URL ?? `http://localhost:${port}`;

createMockMetaServer({ publicUrl })
  .start(port)
  .then((listeningPort) => console.log(`Mock Meta Graph API listening on :${listeningPort} (public url ${publicUrl})`))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
