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
        // 主页: "查看历史" 和 "配置默认响应"
        if (pathname === '/') {
            return (
                <>
                    <Link href="/history" className="btn btn-secondary">查看历史</Link>
                    <Link href="/configs" className="btn btn-primary">配置默认响应</Link>
                </>
            );
        }
        // 配置列表页: "返回" 和 "添加新配置"
        if (pathname === '/configs') {
             return (
                <>
                    <Link href="/" className="btn btn-secondary">&larr; 返回实时事件流</Link>
                    <Link href="/configs/edit" className="btn btn-primary">添加新配置</Link>
                </>
            );
        }
        // 配置编辑页: "返回配置列表"
        if (pathname.startsWith('/configs/edit')) {
            return (
                <Link href="/configs" className="btn btn-secondary">
                    &larr; 返回配置列表
                </Link>
            );
        }
        // 历史页: "返回实时事件流"
        if (pathname.startsWith('/history')) {
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