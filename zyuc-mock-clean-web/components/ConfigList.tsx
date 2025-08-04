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
    Source: string; // 添加 Source 字段
}

const ConfigList = () => {
    const { data: configs, error } = useSWR<Config[]>('/api/configs', fetcher);
    // 新增 SWR hook 来获取所有配置过的设备列表
    const { data: allSources, error: sourcesError } = useSWR<string[]>('/api/configs/sources', fetcher);

    const [projectFilter, setProjectFilter] = useState('');
    const [sourceFilter, setSourceFilter] = useState(''); // 新增设备筛选状态
    const [searchTerm, setSearchTerm] = useState('');

    const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8080';

    const handleDelete = async (endpoint: string) => {
        if (confirm(`确定要删除接口 "${endpoint}" 的配置吗？此操作不可恢复。`)) {
            try {
                await fetch(`${API_BASE_URL}/api/config${endpoint}`, { method: 'DELETE' });
                mutate('/api/configs');
                mutate('/api/configs/sources'); // 删除后同时刷新设备列表
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
            const sourceMatch = !sourceFilter || (config.Source || '未指定') === sourceFilter; // 更新筛选逻辑
            const searchMatch = !searchTerm ||
                config.Endpoint.toLowerCase().includes(searchTerm.toLowerCase()) ||
                (config.Remark && config.Remark.toLowerCase().includes(searchTerm.toLowerCase()));
            return projectMatch && sourceMatch && searchMatch;
        });

        return filtered.reduce((acc, config) => {
            const groupKey = `${config.Project || '未分类'} / ${config.Source || '未指定设备'}`;
            if (!acc[groupKey]) {
                acc[groupKey] = [];
            }
            acc[groupKey].push(config);
            return acc;
        }, {} as Record<string, Config[]>);
    }, [configs, projectFilter, sourceFilter, searchTerm]);
    
    const allProjects = useMemo(() => {
        if (!configs) return [];
        return [...new Set(configs.map(c => c.Project || '未分类'))].sort();
    }, [configs]);

    if (error || sourcesError) return <div>加载配置失败...</div>;
    if (!configs || !allSources) return <div>正在加载...</div>;

    return (
        <div className="list-section">
            <div className="page-actions">
                <h1>现有配置列表</h1>
            </div>

            <div className="filter-section">
                <select value={projectFilter} onChange={e => setProjectFilter(e.target.value)}>
                    <option value="">所有工程</option>
                    {allProjects.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
                {/* 新增设备筛选下拉框 */}
                <select value={sourceFilter} onChange={e => setSourceFilter(e.target.value)}>
                    <option value="">所有设备</option>
                    {allSources.map(s => <option key={s} value={s}>{s}</option>)}
                    <option value="未指定">未指定设备</option>
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
                        Object.entries(groupedConfigs).map(([group, configs]) => (
                            <React.Fragment key={group}>
                                <tr className="project-header">
                                    <td colSpan={3}>{escapeHtml(group)}</td>
                                </tr>
                                {configs.map(config => (
                                    <tr key={config.ID}>
                                        <td className="endpoint-cell">
                                            <div>{escapeHtml(config.Endpoint)}</div>
                                            <div className="remark">{escapeHtml(config.Remark || '无备注')}</div>
                                        </td>
                                        <td>
                                            <pre>{(config.DefaultResponse.substring(0, 150) + (config.DefaultResponse.length > 150 ? '...' : ''))}</pre>
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