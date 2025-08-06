'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface LayoutProps {
    children: React.ReactNode;
    title: string;
}

const Layout = ({ children, title }: LayoutProps) => {
    const pathname = usePathname();

    const renderHeaderButtons = () => {
        if (pathname === '/') {
            return (
                <>
                    <Link href="/history" className="btn btn-secondary">查看 HTTP 历史</Link>
                    <Link href="/ssh-history" className="btn btn-secondary">查看 SSH 历史</Link>
                    <Link href="/configs" className="btn btn-primary">配置 HTTP 响应</Link>
                    <Link href="/ssh-configs" className="btn btn-primary">配置 SSH 响应</Link>
                </>
            );
        }
        if (pathname === '/configs') {
            return (
                <>
                    <Link href="/" className="btn btn-secondary">&larr; 返回实时事件流</Link>
                    <Link href="/configs/edit" className="btn btn-primary">添加新 HTTP 配置</Link>
                </>
            );
        }
        if (pathname.startsWith('/configs/edit')) {
            return (
                <Link href="/configs" className="btn btn-secondary">
                    &larr; 返回 HTTP 配置列表
                </Link>
            );
        }
        if (pathname === '/ssh-configs') {
            return (
                <>
                    <Link href="/" className="btn btn-secondary">&larr; 返回实时事件流</Link>
                    <Link href="/ssh-configs/edit" className="btn btn-primary">添加新 SSH 配置</Link>
                </>
            );
        }
        if (pathname.startsWith('/ssh-configs/edit')) {
            return (
                <Link href="/ssh-configs" className="btn btn-secondary">
                    &larr; 返回 SSH 配置列表
                </Link>
            );
        }
        if (pathname.startsWith('/history')) {
            return (
                <Link href="/" className="btn btn-secondary">
                    &larr; 返回实时事件流
                </Link>
            );
        }
        if (pathname.startsWith('/ssh-history')) {
            return (
                <Link href="/" className="btn btn-secondary">
                    &larr; 返回实时事件流
                </Link>
            );
        }
        return null;
    };

    return (
        <div className="page-wrapper">
            <div className="page-header">
                <h1>{title}</h1>
                <div className="header-buttons">
                    {renderHeaderButtons()}
                </div>
            </div>
            <div className="content-card">
                {children}
            </div>
        </div>
    );
};

export default Layout;