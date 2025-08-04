'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useEventSource, SseEventData } from '../hooks/useEventSource';
import { format } from 'date-fns';

function getApiBaseUrl(): string {
    if (typeof window !== 'undefined' && (window as any).APP_CONFIG) {
        return (window as any).APP_CONFIG.apiBaseUrl;
    }
    return 'http://localhost:8080';
}

const EventItem = ({ eventData, primaryServiceUrl }: { eventData: SseEventData, primaryServiceUrl: string | null }) => {
    const { requestId, payload, endpoint, defaultResponse, project, source } = eventData;
    
    // 组件内部状态，只用于UI展示
    const [responseBody, setResponseBody] = useState(defaultResponse);
    const [status, setStatus] = useState('将在 3 秒后自动返回默认内容...');
    const [isProcessing, setIsProcessing] = useState(false);
    const [isCompleted, setIsCompleted] = useState(false);
    const [timerCleared, setTimerCleared] = useState(false);
    
    // 纯视觉倒计时
    useEffect(() => {
        if (isCompleted || timerCleared) {
            return;
        }
        
        let secondsLeft = 0; // 从2开始，因为第一次更新是1秒后
        setStatus(`将在 0 秒后自动返回默认内容...`);

        const timerId = setInterval(() => {
             if (secondsLeft > 0) {
                 setStatus(`将在 ${secondsLeft} 秒后自动返回默认内容...`);
                 secondsLeft--;
             } else {
                 setStatus('✔ 默认响应已成功发送。');
                 setIsCompleted(true);
                 clearInterval(timerId);
             }
        }, 1000);        
        return () => clearInterval(timerId);
    }, [isCompleted, timerCleared]); 

    const handleInteraction = () => {
        if (!timerCleared) {
            setTimerCleared(true);
            setStatus('已手动修改，请点击按钮提交。');
        }
    };
    
    const handleResponseChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        handleInteraction();
        setResponseBody(e.target.value);
    };

    const sendResponse = async (content: string, responseStatus: 'Custom' | 'Default') => {
        if (isProcessing || isCompleted || !primaryServiceUrl) {
            setStatus(`❌ 发送失败: 主节点未连接。`);
            return;
        }
        handleInteraction(); // 点击按钮也算交互
        setIsProcessing(true);
        setStatus('⏳ 正在发送响应...');

        const targetUrl = `${primaryServiceUrl}/api/respond`;

        try {
            const res = await fetch(targetUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ requestId, responseBody: content, source }),
            });
            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.error || '无法发送响应。');
            }
            const statusText = responseStatus === 'Custom' ? '自定义响应' : '默认响应';
            setStatus(`✔ ${statusText}已成功发送。`);
            setIsCompleted(true);
        } catch (error: any) {
            setStatus(`❌ 发送失败: ${error.message}`);
            setIsProcessing(false);
        }
    };
    
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
                <span className="endpoint">
                    请求接口: {source} {endpoint} ({project || '未分类'})
                </span>
                <span>接收于: {format(new Date(), 'HH:mm:ss')}</span>
            </div>
            <pre><code>{displayData}</code></pre>
            <div className="response-editor">
                <textarea
                    value={responseBody}
                    onChange={handleResponseChange}
                    readOnly={isProcessing || isCompleted}
                    style={{ backgroundColor: (isProcessing || isCompleted) ? '#f1f3f5' : 'white' }}
                />
                <div className="controls">
                    <p className="status">{status}</p>
                    <div className="buttons">
                        <button onClick={() => sendResponse(responseBody, 'Custom')} disabled={isProcessing || isCompleted} className={isCompleted ? "" : "custom-btn"}>返回自定义内容</button>
                        <button onClick={() => sendResponse(defaultResponse, 'Default')} disabled={isProcessing || isCompleted} className={isCompleted ? "" : "default-btn"}>返回默认值</button>
                    </div>
                </div>
            </div>
        </li>
    );
};

// EventStream 组件保持不变
const EventStream = () => {
    // ... (代码与上一版本相同)
    const [bootstrapUrl, setBootstrapUrl] = useState('');
    
    useEffect(() => {
        const apiUrl = getApiBaseUrl();
        setBootstrapUrl(apiUrl);
    }, []);

    const { events, connectionStatus, allServices, primaryService } = useEventSource(bootstrapUrl);
    const [projectFilter, setProjectFilter] = useState('');
    const [sourceFilter, setSourceFilter] = useState('');
    const [searchTerm, setSearchTerm] = useState('');

    const primaryServiceUrl = useMemo(() => {
        if (!primaryService || !bootstrapUrl) return null;
        const protocol = new URL(bootstrapUrl).protocol;
        return `${protocol}//${primaryService}`;
    }, [primaryService, bootstrapUrl]);

    const allProjects = useMemo(() => {
        const projects = new Set(events.map(e => e.project || '未分类'));
        return [...projects].sort();
    }, [events]);
    
    const allSourcesList = useMemo(() => {
        return [...allServices].sort();
    }, [allServices]);

    const filteredEvents = useMemo(() => {
        return events.filter(event => 
            (!projectFilter || (event.project || '未分类') === projectFilter) &&
            (!sourceFilter || event.source === sourceFilter) &&
            (!searchTerm || event.endpoint.toLowerCase().includes(searchTerm.toLowerCase()) || event.payload.toLowerCase().includes(searchTerm.toLowerCase()))
        );
    }, [events, projectFilter, sourceFilter, searchTerm]);


    return (
        <div>
            <div className="service-status-container">
                <h3>后端服务状态</h3>
                <div className="connection-status-list">
                   {allServices.map(url => (
                       <div key={url} className="connection-status-item">
                           <span>{url} {url === primaryService ? '(主)' : ''}</span>
                           <span className={connectionStatus[url] ? 'status-ok' : 'status-fail'}>
                               {connectionStatus[url] ? '✅' : '❌'}
                           </span>
                       </div>
                   ))}
                   {allServices.length === 0 && <div className="connection-status-item">正在发现服务...</div>}
                </div>
            </div>

            <div className="filter-section">
                <select value={projectFilter} onChange={e => setProjectFilter(e.target.value)}>
                    <option value="">所有工程</option>
                    {allProjects.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
                 <select value={sourceFilter} onChange={e => setSourceFilter(e.target.value)}>
                    <option value="">所有在线设备</option>
                    {allSourcesList.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <input
                    type="text"
                    placeholder="按路径或内容模糊搜索..."
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                />
            </div>
            
            <ul className="events-list">
                {filteredEvents.map(event => (
                    <EventItem 
                        key={event.requestId} 
                        eventData={event}
                        primaryServiceUrl={primaryServiceUrl}
                    />
                ))}
            </ul>
        </div>
    );
};

export default EventStream;