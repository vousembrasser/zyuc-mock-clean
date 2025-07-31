'use client';
import React from 'react';
import useSWR, { mutate } from 'swr';
import Link from 'next/link';
import { useState, useMemo } from 'react';
import { fetcher, escapeHtml } from '../lib/utils';

interface Config {
    ID: number;
    Endpoint: string;
    Project: string;
    Remark: string;
    DefaultResponse: string;
}

const ConfigList = () => {
    const { data: configs, error } = useSWR<Config[]>('/api/configs', fetcher);
    const [projectFilter, setProjectFilter] = useState('');
    const [searchTerm, setSearchTerm] = useState('');

    // 使用环境变量获取后端地址
    const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8080';

    const handleDelete = async (endpoint: string) => {
        if (confirm(`确定要删除接口 "${endpoint}" 的配置吗？此操作不可恢复。`)) {
            try {
                await fetch(`${API_BASE_URL}/api/config${endpoint}`, { method: 'DELETE' });
                mutate('/api/configs'); // 重新请求数据
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
                config.Endpoint.toLowerCase().includes(searchTerm.toLowerCase()) ||
                (config.Remark && config.Remark.toLowerCase().includes(searchTerm.toLowerCase()));
            return projectMatch && searchMatch;
        });

        return filtered.reduce((acc, config) => {
            const project = config.Project || '未分类';
            if (!acc[project]) {
                acc[project] = [];
            }
            acc[project].push(config);
            return acc;
        }, {} as Record<string, Config[]>);
    }, [configs, projectFilter, searchTerm]);
    
    const allProjects = useMemo(() => {
        if (!configs) return [];
        return [...new Set(configs.map(c => c.Project || '未分类'))].sort();
    }, [configs]);

    if (error) return <div>加载配置失败...</div>;
    if (!configs) return <div>正在加载...</div>;

    return (
        <div className="list-section">
            {/* 移除了旧的 .page-actions 容器，因为按钮已移至 Layout 组件 */}
            <div className="page-actions">
                <h1>现有配置列表</h1>
            </div>

            <div className="filter-section">
                <select value={projectFilter} onChange={e => setProjectFilter(e.target.value)}>
                    <option value="">所有工程</option>
                    {allProjects.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
                <input
                    type="text"
                    placeholder="按路径或备注模糊搜索..."
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                />
            </div>
            <table id="configs-table">
                <thead>
                    <tr>
                        <th>接口路径 / 备注</th>
                        <th>默认响应 (预览)</th>
                        <th>操作</th>
                    </tr>
                </thead>
                <tbody>
                    {Object.keys(groupedConfigs).length === 0 ? (
                        <tr><td colSpan={3} style={{ textAlign: 'center' }}>未找到匹配的配置。</td></tr>
                    ) : (
                        Object.entries(groupedConfigs).map(([project, configs]) => (
                            <React.Fragment key={project}>
                                <tr className="project-header">
                                    <td colSpan={3}>{escapeHtml(project)}</td>
                                </tr>
                                {configs.map(config => (
                                    <tr key={config.ID}>
                                        <td className="endpoint-cell">
                                            <div>{escapeHtml(config.Endpoint)}</div>
                                            <div className="remark">{escapeHtml(config.Remark || '无备注')}</div>
                                        </td>
                                        <td>
                                            <pre>{escapeHtml(config.DefaultResponse.substring(0, 150) + (config.DefaultResponse.length > 150 ? '...' : ''))}</pre>
                                        </td>
                                        <td>
                                            <div className="actions">
                                                <Link href={`/configs/edit?endpoint=${encodeURIComponent(config.Endpoint)}`} className="btn btn-sm btn-success">编辑</Link>
                                                <button onClick={() => handleDelete(config.Endpoint)} className="btn btn-sm btn-danger">删除</button>
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

export default ConfigList;