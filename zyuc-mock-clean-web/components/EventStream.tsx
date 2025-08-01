'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useEventSource, SseEventData } from '../hooks/useEventSource';
import { escapeHtml } from '../lib/utils';
import { format } from 'date-fns';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8080';

// 单个事件项的组件
const EventItem = ({ eventData }: { eventData: SseEventData }) => {
    const { requestId, payload, endpoint, defaultResponse, project, source } = eventData;
    const [responseBody, setResponseBody] = useState(defaultResponse);
    const [status, setStatus] = useState(`将在 3 秒后自动返回默认内容...`);
    const [isProcessing, setIsProcessing] = useState(false);
    const [isCompleted, setIsCompleted] = useState(false);
    const [hasManuallyModified, setHasManuallyModified] = useState(false);

    useEffect(() => {
        if (isCompleted || hasManuallyModified) {
            return;
        }
        const timerId = setTimeout(() => {
            if (!isProcessing) {
                sendResponse(defaultResponse, 'Auto-Responded');
            }
        }, 3000);
        return () => clearTimeout(timerId);
    }, [responseBody, isProcessing, isCompleted, defaultResponse, requestId]);

    const handleResponseChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        if (!hasManuallyModified) {
            setHasManuallyModified(true);
            setStatus('请手动点击提交任务');
        }
        setResponseBody(e.target.value);
    };

    const sendResponse = async (content: string, responseStatus: string) => {
        if (isProcessing || isCompleted) return;
        setIsProcessing(true);
        setStatus('⏳ 正在发送响应...');

        try {
            const res = await fetch(`http://${source}/api/respond`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ requestId, responseBody: content }),
            });
            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.error || '无法发送响应。');
            }
            setStatus(`✔ ${responseStatus === 'Custom' ? '自定义响应' : '默认响应'}已成功发送。`);
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
                        <button onClick={() => sendResponse(responseBody, 'Custom')} disabled={isProcessing || isCompleted} className="custom-btn">返回自定义内容</button>
                        <button onClick={() => sendResponse(defaultResponse, 'Default')} disabled={isProcessing || isCompleted} className="default-btn">返回默认值</button>
                    </div>
                </div>
            </div>
        </li>
    );
};


// The main component
const EventStream = () => {
    const [bootstrapUrl, setBootstrapUrl] = useState('');
    
    useEffect(() => {
        // Set the URL only after the component mounts and window is available.
        setBootstrapUrl(getBootstrapUrl());
    }, []);

    const [backendUrls, setBackendUrls] = useState<string[]>([]);
    const { events, connectionStatus } = useEventSource(backendUrls);
    const [projectFilter, setProjectFilter] = useState('');
    const [sourceFilter, setSourceFilter] = useState('');
    const [searchTerm, setSearchTerm] = useState('');

    useEffect(() => {
        if (!bootstrapUrl) return; // Don't fetch if the bootstrap URL isn't set yet

        const fetchServices = async () => {
            try {
                const response = await fetch(`${bootstrapUrl}/api/services`);
                if (!response.ok) throw new Error(`Failed to fetch service list: ${response.statusText}`);
                const services: string[] = await response.json();
                services.sort();
                setBackendUrls(currentUrls => JSON.stringify(currentUrls) !== JSON.stringify(services) ? services : currentUrls);
            } catch (error) {
                console.error("Error polling for services:", error);
                const host = new URL(bootstrapUrl).host;
                setBackendUrls(prev => (prev.length === 0 ? [host] : prev));
            }
        };
        fetchServices();
        const intervalId = setInterval(fetchServices, 7000);
        return () => clearInterval(intervalId);
    }, [bootstrapUrl]); // Re-run when bootstrapUrl is set

    // ... (other useMemo and useEffect hooks are the same) ...
    const allProjects = useMemo(() => {
        const projects = new Set(events.map(e => e.project || '未分类'));
        return [...projects].sort();
    }, [events]);

    const connectedSources = useMemo(() => {
        return Object.entries(connectionStatus)
            .filter(([, isConnected]) => isConnected)
            .map(([url]) => url)
            .sort();
    }, [connectionStatus]);
    
    useEffect(() => {
        if (sourceFilter && !connectedSources.includes(sourceFilter)) {
            setSourceFilter('');
        }
    }, [sourceFilter, connectedSources]);

    const filteredEvents = useMemo(() => {
        return events.filter(event => {
            const projectMatch = !projectFilter || (event.project || '未分类') === projectFilter;
            const sourceMatch = !sourceFilter || event.source === sourceFilter;
            const searchMatch = !searchTerm ||
                event.endpoint.toLowerCase().includes(searchTerm.toLowerCase()) ||
                event.payload.toLowerCase().includes(searchTerm.toLowerCase());
            return projectMatch && sourceMatch && searchMatch;
        });
    }, [events, projectFilter, sourceFilter, searchTerm]);


    return (
        <div>
            <div className="service-status-container">
                <h3>后端服务状态</h3>
                <div className="connection-status-list">
                   {backendUrls.map(url => (
                       <div key={url} className="connection-status-item">
                           <span>{url}</span>
                           <span className={connectionStatus[url] ? 'status-ok' : 'status-fail'}>
                               {connectionStatus[url] ? '✅' : '❌'}
                           </span>
                       </div>
                   ))}
                   {backendUrls.length === 0 && <div className="connection-status-item">连接引导节点...</div>}
                </div>
            </div>

            <div className="filter-section">
                <select value={projectFilter} onChange={e => setProjectFilter(e.target.value)}>
                    <option value="">所有工程</option>
                    {allProjects.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
                 <select value={sourceFilter} onChange={e => setSourceFilter(e.target.value)}>
                    <option value="">所有在线设备</option>
                    {connectedSources.map(s => <option key={s} value={s}>{s}</option>)}
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
                    <EventItem key={event.requestId} eventData={event} />
                ))}
            </ul>
        </div>
    );
};

export default EventStream;