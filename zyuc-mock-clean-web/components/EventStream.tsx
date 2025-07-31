'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useEventSource, SseEventData } from '../hooks/useEventSource';
import { escapeHtml } from '../lib/utils';
import { format } from 'date-fns';

// 在组件外部或顶部定义
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8080';

// 单个事件项的组件
const EventItem = ({ eventData }: { eventData: SseEventData }) => {
    // ... (state 和 useEffect 不变) ...
    const { requestId, payload, endpoint, defaultResponse, project } = eventData;
    const [responseBody, setResponseBody] = useState(defaultResponse);
    const [status, setStatus] = useState(`将在 3 秒后自动返回默认内容...`);
    const [isProcessing, setIsProcessing] = useState(false);

    useEffect(() => {
        const timerId = setTimeout(() => {
            if (!isProcessing) {
                sendResponse(defaultResponse, 'Auto-Responded');
            }
        }, 3000);

        return () => clearTimeout(timerId);
    }, [defaultResponse, isProcessing]);


    const sendResponse = async (content: string, responseStatus: string) => {
        if (isProcessing) return;
        setIsProcessing(true);
        setStatus('⏳ 正在发送响应...');

        try {
            // 【修改这里】: 为 fetch 的 URL 添加前缀
            const res = await fetch(`${API_BASE_URL}/api/respond`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ requestId, responseBody: content }),
            });
            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.error || '无法发送响应。');
            }
            setStatus(`✔ ${responseStatus === 'Custom' ? '自定义响应' : '默认响应'}已成功发送。`);
        } catch (error: any) {
            setStatus(`❌ 发送失败: ${error.message}`);
        }
    };
    
    // ... (return JSX 不变) ...
    let displayData = payload;
    let dataType = 'is-text';
    try {
        const jsonData = JSON.parse(payload);
        displayData = JSON.stringify(jsonData, null, 2);
        dataType = 'is-json';
    } catch (e) { /* 不是JSON，保持原样 */ }

    return (
        <li className={`new-event-highlight ${dataType}`}>
            <div className="event-header">
                <span className="endpoint">请求接口: {escapeHtml(endpoint)} ({project || '未分类'})</span>
                <span>接收于: {format(new Date(), 'HH:mm:ss')}</span>
            </div>
            <pre><code>{displayData}</code></pre>
            <div className="response-editor">
                <textarea
                    value={responseBody}
                    onChange={(e) => setResponseBody(e.target.value)}
                    readOnly={isProcessing}
                    style={{ backgroundColor: isProcessing ? '#f1f3f5' : 'white' }}
                />
                <div className="controls">
                    <p className="status">{status}</p>
                    <div className="buttons">
                        <button onClick={() => sendResponse(responseBody, 'Custom')} disabled={isProcessing} className="custom-btn">返回自定义内容</button>
                        <button onClick={() => sendResponse(defaultResponse, 'Default')} disabled={isProcessing} className="default-btn">返回默认值</button>
                    </div>
                </div>
            </div>
        </li>
    );
};

// ... (主组件 EventStream 不变) ...
// 主组件
const EventStream = () => {
    const { events, isConnected } = useEventSource('/api/events?mode=interactive');
    // ... (state and memos) ...
    const [projectFilter, setProjectFilter] = useState('');
    const [searchTerm, setSearchTerm] = useState('');

    const allProjects = useMemo(() => {
        const projects = new Set(events.map(e => e.project || '未分类'));
        return [...projects].sort();
    }, [events]);

    const filteredEvents = useMemo(() => {
        return events.filter(event => {
            const projectMatch = !projectFilter || (event.project || '未分类') === projectFilter;
            const searchMatch = !searchTerm ||
                event.endpoint.toLowerCase().includes(searchTerm.toLowerCase()) ||
                event.payload.toLowerCase().includes(searchTerm.toLowerCase());
            return projectMatch && searchMatch;
        });
    }, [events, projectFilter, searchTerm]);

    return (
        <div>
            <div className="filter-section">
                <select value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)}>
                    <option value="">所有工程</option>
                    {allProjects.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
                <input
                    type="text"
                    placeholder="按路径或内容模糊搜索..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                />
                
                {/* --- 修改这里 --- */}
                <div className="connection-status">
                   <span>连接状态: {isConnected ? '✅ 已连接' : '❌ 已断开'}</span>
                </div>
                {/* --- 修改结束 --- */}

            </div>
            <ul id="events">
                {filteredEvents.map(event => (
                    <EventItem key={event.requestId} eventData={event} />
                ))}
            </ul>
        </div>
    );
};

export default EventStream;