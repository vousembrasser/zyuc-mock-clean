import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
    title: 'ZYUC Mock-Clean',
    description: 'A Next.js implementation of the mock service UI',
};

export default function RootLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <html lang="zh-CN">
            <head>
                {/* THE FIX: This script will be served dynamically by the Go backend */}
                <script src="/app.config.js"></script>
            </head>
            <body>
                <main className="container" style={{backgroundColor: 'transparent', boxShadow: 'none', padding: 0}}>
                    {children}
                </main>
            </body>
        </html>
    );
}