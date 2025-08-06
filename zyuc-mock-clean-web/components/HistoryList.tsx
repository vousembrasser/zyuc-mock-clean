'use client';

import useSWR from 'swr';
import { useState, useMemo } from 'react';
import { fetcher, debounce } from '../lib/utils';
import { format } from 'date-fns';

interface EventHistory {
    Endpoint: string;
    Project: string;
    Payload: string;
    ResponseBody: string;
    Status: string;
    Timestamp: string;
    Source: string;
}

interface HistoryResponse {
    data: EventHistory[];
    total: number;
    page: number;
    pageSize: number;
}

const HistoryList = () => {
    const [page, setPage] = useState(1);
    const [projectFilter, setProjectFilter] = useState('');
    const [sourceFilter, setSourceFilter] = useState('');
    const [searchTerm, setSearchTerm] = useState('');
    const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');

    const debounceSearch = useMemo(() => debounce((value: string) => {
        setPage(1);
        setDebouncedSearchTerm(value);
    }, 300), []);

    const handleFilterChange = (setter: React.Dispatch<React.SetStateAction<string>>) => (e: React.ChangeEvent<HTMLSelectElement>) => {
        setPage(1);
        setter(e.target.value);
    };

    const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setSearchTerm(e.target.value);
        debounceSearch(e.target.value);
    };

    // --- SWR hooks are now separate again ---
    const { data: historyData, error: historyError } = useSWR<HistoryResponse>(
        `/api/history?page=${page}&pageSize=20&project=${encodeURIComponent(projectFilter)}&source=${encodeURIComponent(sourceFilter)}&search=${encodeURIComponent(debouncedSearchTerm)}`,
        fetcher,
        { keepPreviousData: true }
    );

    const { data: configs, error: configsError } = useSWR<any[]>('/api/configs', fetcher);

    // This hook now correctly fetches from the restored endpoint
    const { data: allSources, error: sourcesError } = useSWR<string[]>('/api/history/sources', fetcher);

    const allProjects = useMemo(() => {
        if (!configs) return [];
        return [...new Set(configs.map(c => c.Project || ''))].filter(Boolean).sort();
    }, [configs]);

    const isLoading = !historyData || !configs || !allSources;
    const hasError = historyError || configsError || sourcesError;

    if (hasError) return <div>加载历史记录失败...</div>;
    if (isLoading) return <div>正在加载...</div>;

    const { data, total, pageSize } = historyData;
    const totalPages = Math.ceil(total / pageSize);

    return (
        <div className="list-section">
            <div className="filter-section">
                <select value={projectFilter} onChange={handleFilterChange(setProjectFilter)}>
                    <option value="">所有工程</option>
                    {allProjects.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
                <select value={sourceFilter} onChange={handleFilterChange(setSourceFilter)}>
                    <option value="">所有设备</option>
                    {Array.isArray(allSources) && allSources.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <input
                    type="text"
                    placeholder="按路径或内容模糊搜索..."
                    value={searchTerm}
                    onChange={handleSearchChange}
                />
            </div>
            <table id="history-table">
                <thead>
                <tr>
                    <th style={{width: '20%'}}>接口 / 工程</th>
                    <th style={{width: '15%'}}>来源 (IP:Port)</th>
                    <th style={{width: '25%'}}>请求内容 (Payload)</th>
                    <th style={{width: '25%'}}>响应内容 (Response)</th>
                    <th style={{width: '15%'}}>状态 / 时间</th>
                </tr>
                </thead>
                <tbody>
                {data && data.length > 0 ? (
                    data.map((event, index) => (
                        <tr key={index}>
                            <td className="endpoint-cell">
                                <div>{event.Endpoint}</div>
                                <div className="project">{event.Project || '未分类'}</div>
                            </td>
                            <td>{event.Source || 'N/A'}</td>
                            <td><pre>{event.Payload}</pre></td>
                            <td><pre>{event.ResponseBody}</pre></td>
                            <td className="status-cell">
                                <span className={`status status-${event.Status.replace(/[\s()]/g, '-')}`}>{event.Status}</span>
                                <span className="timestamp">{format(new Date(event.Timestamp), 'yyyy-MM-dd HH:mm:ss')}</span>
                            </td>
                        </tr>
                    ))
                ) : (
                    <tr><td colSpan={5} style={{ textAlign: 'center' }}>未找到历史记录。</td></tr>
                )}
                </tbody>
            </table>
            <div className="pagination">
                <button onClick={() => setPage(p => p - 1)} disabled={page <= 1}>上一页</button>
                <span className="page-info">第 {page} / {totalPages} 页</span>
                <button onClick={() => setPage(p => p + 1)} disabled={page >= totalPages}>下一页</button>
            </div>
        </div>
    );
};

export default HistoryList;