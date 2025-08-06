'use client';
import React from 'react';
import useSWR, { mutate } from 'swr';
import Link from 'next/link';
import { useState, useMemo } from 'react';
import { fetcher, escapeHtml } from '../lib/utils';

interface SshConfig {
    ID: number;
    Command: string;
    Project: string;
    Remark: string;
    Response: string;
}

const SshConfigList = () => {
    const { data: configs, error } = useSWR<SshConfig[]>('/api/ssh/configs', fetcher);
    const [projectFilter, setProjectFilter] = useState('');
    const [searchTerm, setSearchTerm] = useState('');

    function getApiBaseUrl(): string {
        if (typeof window !== 'undefined' && (window as any).APP_CONFIG) {
            return (window as any).APP_CONFIG.apiBaseUrl || 'http://localhost:8080';
        }
        return 'http://localhost:8080';
    }

    const handleDelete = async (command: string) => {
        if (confirm(`确定要删除命令 "${command}" 的配置吗？此操作不可恢复。`)) {
            try {
                const API_BASE_URL = getApiBaseUrl();
                await fetch(`${API_BASE_URL}/api/ssh/config/${encodeURIComponent(command)}`, { method: 'DELETE' });
                mutate('/api/ssh/configs');
                alert('配置已成功删除！');
            } catch (err) {
                alert('删除失败，请检查服务日志。');
            }
        }
    };

    const groupedConfigs = useMemo(() => {
        if (!configs) return {};
        const filtered = configs.filter(config => {
            const projectMatch = !projectFilter || (config.Project || '未分类') === projectFilter;
            const searchMatch = !searchTerm ||
                config.Command.toLowerCase().includes(searchTerm.toLowerCase()) ||
                (config.Remark && config.Remark.toLowerCase().includes(searchTerm.toLowerCase()));
            return projectMatch && searchMatch;
        });

        return filtered.reduce((acc, config) => {
            const groupKey = config.Project || '未分类';
            if (!acc[groupKey]) {
                acc[groupKey] = [];
            }
            acc[groupKey].push(config);
            return acc;
        }, {} as Record<string, SshConfig[]>);
    }, [configs, projectFilter, searchTerm]);

    const allProjects = useMemo(() => {
        if (!configs) return [];
        return [...new Set(configs.map(c => c.Project || '未分类'))].sort();
    }, [configs]);

    if (error) return <div>加载配置失败...</div>;
    if (!configs) return <div>正在加载...</div>;

    return (
        <div className="list-section">
            <div className="page-actions">
                <h1>SSH 命令 Mock 配置</h1>
            </div>

            <div className="filter-section">
                <select value={projectFilter} onChange={e => setProjectFilter(e.target.value)}>
                    <option value="">所有工程</option>
                    {allProjects.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
                <input
                    type="text"
                    placeholder="按命令或备注模糊搜索..."
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                />
            </div>
            <table id="configs-table">
                <thead>
                <tr>
                    <th>命令 / 备注</th>
                    <th>响应 (预览)</th>
                    <th>操作</th>
                </tr>
                </thead>
                <tbody>
                {Object.keys(groupedConfigs).length === 0 ? (
                    <tr><td colSpan={3} style={{ textAlign: 'center' }}>未找到匹配的配置。</td></tr>
                ) : (
                    Object.entries(groupedConfigs).map(([group, configs]) => (
                        <React.Fragment key={group}>
                            <tr className="project-header">
                                <td colSpan={3}>{escapeHtml(group)}</td>
                            </tr>
                            {configs.map(config => (
                                <tr key={config.ID}>
                                    <td className="endpoint-cell">
                                        <div>{escapeHtml(config.Command)}</div>
                                        <div className="remark">{escapeHtml(config.Remark || '无备注')}</div>
                                    </td>
                                    <td>
                                        <pre>{(config.Response.substring(0, 150) + (config.Response.length > 150 ? '...' : ''))}</pre>
                                    </td>
                                    <td>
                                        <div className="actions">
                                            <Link href={`/ssh-configs/edit?command=${encodeURIComponent(config.Command)}`} className="btn btn-sm btn-success">编辑</Link>
                                            <button onClick={() => handleDelete(config.Command)} className="btn btn-sm btn-danger">删除</button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </React.Fragment>
                    ))
                )}
                </tbody>
            </table>
        </div>
    );
};

export default SshConfigList;