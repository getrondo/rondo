import type { ReactNode } from 'react';

export const metadata = { metadataBase: new URL('https://rondo-alpha.vercel.app'), title: 'Rondo', description: 'Football community bot' };

export default function RootLayout({ children }: { readonly children: ReactNode }) {
    return (
        <html lang="uk">
            <body style={{ fontFamily: 'system-ui, sans-serif', margin: '3rem' }}>{children}</body>
        </html>
    );
}
