// 在文件顶部定义 API 基础 URL
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8080';

// 新增一个函数来安全地获取全局配置
function getApiBaseUrl(): string {
    if (typeof window !== 'undefined' && (window as any).APP_CONFIG) {
        return (window as any).APP_CONFIG.apiBaseUrl || 'http://localhost:8080';
    }
    // 提供一个备用地址，以防脚本加载失败
    return 'http://localhost:8080';
}

export function escapeHtml(unsafe: string | null | undefined): string {
    if (!unsafe) return '';
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// 修改 fetcher，让它为所有 SWR 请求添加 URL 前缀
export const fetcher = (url: string) => {
    const API_BASE_URL = getApiBaseUrl();
    return fetch(`${API_BASE_URL}${url}`).then(res => res.json());
}

export function debounce<F extends (...args: any[]) => any>(func: F, delay: number): (...args: Parameters<F>) => void {
    let timeout: NodeJS.Timeout;
    return function(this: any, ...args: Parameters<F>) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), delay);
    };
}