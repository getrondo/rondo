import path from 'node:path';

import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
    outputFileTracingRoot: path.join(import.meta.dirname, '../../'),
    transpilePackages: ['@rondo/assistant', '@rondo/bot', '@rondo/core', '@rondo/db', '@rondo/telegram'],
    serverExternalPackages: ['pg'],
    poweredByHeader: false
};

export default nextConfig;
