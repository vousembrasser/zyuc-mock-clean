'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import useSWR from 'swr';
import { fetcher } from '../lib/utils';
import Link from "next/link";

function getApiBaseUrl(): string {
    if (typeof window !== 'undefined' && (window as any).APP_CONFIG) {
        return (window as any).APP_CONFIG.apiBaseUrl || 'http://localhost:8080';
    }
    return 'http://localhost:8080';
}

interface ResponseRule {
    ID: number;
    Keyword: string;
    Response: string;
}

const ConfigForm = () => {
    const router = useRouter();
    const searchParams = useSearchParams();
    const endpointToEdit = searchParams.get('endpoint');

    const [isEditMode, setIsEditMode] = useState(!!endpointToEdit);
    const [currentEndpoint, setCurrentEndpoint] = useState(endpointToEdit);
    const [activeView, setActiveView] = useState<'config' | 'rules'>('config');

    const swrKey = currentEndpoint ? `/api/config${currentEndpoint}` : null;
    const { data: config, error, mutate: mutateConfig } = useSWR(swrKey, fetcher);

    const [endpointInput, setEndpointInput] = useState(endpointToEdit || '');
    const [project, setProject] = useState('');
    const [remark, setRemark] = useState('');
    const [defaultResponse, setDefaultResponse] = useState('');
    const [source, setSource] = useState('');
    const [statusMessage, setStatusMessage] = useState({ text: '', type: '' });

    const [newKeyword, setNewKeyword] = useState('');
    const [newResponse, setNewResponse] = useState('');

    const [editingRuleId, setEditingRuleId] = useState<number | null>(null);

    const ruleFormRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (isEditMode && config) {
            setProject(config.Project || '');
            setRemark(config.Remark || '');
            setDefaultResponse(config.DefaultResponse || '');
            setSource(config.Source || '');
            setEndpointInput(config.Endpoint || '');
        }
    }, [isEditMode, config]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!endpointInput.startsWith('/')) {
            setStatusMessage({ text: '接口路径必须以 / 开头。', type: 'error' });
            return;
        }

        setStatusMessage({ text: '正在保存...', type: 'info' });

        const API_BASE_URL = getApiBaseUrl(); // 在事件处理函数中获取
        try {
            const res = await fetch(`${API_BASE_URL}/api/config`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ endpoint: endpointInput, project, remark, defaultResponse, source }),
            });

            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.error || '保存失败');
            }

            setStatusMessage({ text: '配置已成功保存！', type: 'success' });

            if (!isEditMode) {
                router.push(`/configs/edit?endpoint=${encodeURIComponent(endpointInput)}`);
            } else {
                mutateConfig();
            }

        } catch (err: any) {
            setStatusMessage({ text: `错误: ${err.message}`, type: 'error' });
        }
    };

    const handleRuleSubmit = async () => {
        if (editingRuleId) {
            await handleUpdateRule(editingRuleId);
        } else {
            await handleAddRule();
        }
    };

    const handleAddRule = async () => {
        if (!newKeyword.trim() || !config?.ID) return;
        const API_BASE_URL = getApiBaseUrl(); // 在事件处理函数中获取
        try {
            const res = await fetch(`${API_BASE_URL}/api/rules`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ configID: config.ID, keyword: newKeyword, response: newResponse }),
            });
            if (!res.ok) throw new Error('添加规则失败');
            const newRule = await res.json();
            mutateConfig((current: any) => ({ ...current, Rules: [...(current.Rules || []), newRule] }), { revalidate: false });
            setNewKeyword('');
            setNewResponse('');
        } catch (err) {
            alert('添加规则失败，请检查服务日志。');
        }
    };

    const handleUpdateRule = async (ruleId: number) => {
        const API_BASE_URL = getApiBaseUrl();
        try {
            const res = await fetch(`${API_BASE_URL}/api/rules/${ruleId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ keyword: newKeyword, response: newResponse }),
            });
            if (!res.ok) throw new Error('更新规则失败');
            const updatedRule = await res.json();
            mutateConfig((current: any) => ({
                ...current,
                Rules: current.Rules.map((r: ResponseRule) => (r.ID === ruleId ? updatedRule : r)),
            }), { revalidate: false });
            setEditingRuleId(null);
            setNewKeyword('');
            setNewResponse('');
        } catch (err) {
            alert('更新规则失败，请检查服务日志。');
        }
    };

    const handleEditClick = (rule: ResponseRule) => {
        setEditingRuleId(rule.ID);
        setNewKeyword(rule.Keyword);
        setNewResponse(rule.Response);
        ruleFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };

    const handleCancelEdit = () => {
        setEditingRuleId(null);
        setNewKeyword('');
        setNewResponse('');
    };

    const handleDeleteRule = async (ruleId: number) => {
        if (confirm('确定要删除这条规则吗？')) {
            const API_BASE_URL = getApiBaseUrl(); // 在事件处理函数中获取
            try {
                const res = await fetch(`${API_BASE_URL}/api/rules/${ruleId}`, { method: 'DELETE' });
                if (!res.ok) throw new Error('删除规则失败');
                mutateConfig((current: any) => ({ ...current, Rules: current.Rules.filter((r: ResponseRule) => r.ID !== ruleId) }), { revalidate: false });
            } catch (err) {
                alert('删除规则失败，请检查服务日志。');
            }
        }
    };

    if (isEditMode && error) return <div>加载配置失败...</div>;
    if (isEditMode && !config) return <div>正在加载配置...</div>;

    return (
        <div className="config-page-container" onMouseLeave={() => setActiveView('config')}>
            {/* --- Card 1: Main Config --- */}
            <div className={`config-card ${activeView === 'config' ? 'is-active' : ''}`} onMouseEnter={() => setActiveView('config')}>
                <form id="config-form" onSubmit={handleSubmit}>
                    <h1>{isEditMode ? '编辑配置' : '添加新配置'}</h1>
                    <div className="form-group">
                        <label htmlFor="project">所属工程 (Project)</label>
                        <input type="text" id="project" value={project} onChange={e => setProject(e.target.value)} placeholder="例如：用户中心" />
                    </div>
                    <div className="form-group">
                        <label htmlFor="source">设备 (Source)</label>
                        <input type="text" id="source" value={source} onChange={e => setSource(e.target.value)} placeholder="例如：127.0.0.1:8080" />
                        <small>留空表示此配置适用于所有设备。</small>
                    </div>
                    <div className="form-group">
                        <label htmlFor="remark">备注 (Remark)</label>
                        <input type="text" id="remark" value={remark} onChange={e => setRemark(e.target.value)} placeholder="例如：获取用户信息接口" />
                    </div>
                    <div className="form-group">
                        <label htmlFor="endpoint">接口路径 (Endpoint)</label>
                        <input type="text" id="endpoint" value={endpointInput} onChange={e => setEndpointInput(e.target.value)} readOnly={isEditMode} placeholder="/my/custom/api" required />
                    </div>
                    <div className="form-group">
                        <label htmlFor="defaultResponse">默认响应内容</label>
                        <textarea id="defaultResponse" value={defaultResponse} onChange={e => setDefaultResponse(e.target.value)} placeholder='{"code": 200, "message": "OK" ...}' required />
                    </div>

                    <div className="form-buttons">
                        {/* THE FIX: Added 'btn' and 'btn-primary' classes */}
                        <button type="submit" className="btn btn-primary">{isEditMode ? '更新配置' : '保存并配置规则'}</button>
                    </div>
                    {statusMessage.text && (
                        <div id="status-message" className={statusMessage.type}>
                            {statusMessage.text}
                        </div>
                    )}
                </form>
            </div>

            {/* --- Card 2: Rules --- */}
            <div className={`rules-card ${activeView === 'rules' ? 'is-active' : ''}`} onMouseEnter={() => setActiveView('rules')}>
                <div className="rules-card-header">
                    <h2>内容路由规则</h2>
                </div>
                <div className="rules-card-content">
                    <p>如果请求内容包含关键字，将返回特定响应，否则返回默认响应。</p>

                    {!isEditMode && (
                        <div className="rules-disabled-overlay">
                            <p>请先保存主配置以启用规则管理</p>
                        </div>
                    )}

                    <div className="rules-table-container">
                        <table className="rules-table">
                            <thead>
                            <tr>
                                <th>关键字</th>
                                <th>预览</th>
                                <th>操作</th>
                            </tr>
                            </thead>
                            <tbody>
                            {config?.Rules && config.Rules.length > 0 ? (
                                config.Rules.map((rule: ResponseRule) => (
                                    <tr key={rule.ID}>
                                        <td><pre>{rule.Keyword}</pre></td>
                                        <td>
                                                <pre>
                                                    {rule.Response.length > 100
                                                        ? `${rule.Response.substring(0, 100)}...`
                                                        : rule.Response}
                                                </pre>
                                        </td>
                                        <td>
                                            <div className="actions">
                                                <button onClick={() => handleEditClick(rule)} className="btn btn-sm btn-success">编辑</button>
                                                <button onClick={() => handleDeleteRule(rule.ID)} className="btn btn-sm btn-danger">删除</button>
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            ) : (
                                <tr>
                                    <td colSpan={3} style={{ textAlign: 'center' }}>暂无规则。</td>
                                </tr>
                            )}
                            </tbody>
                        </table>
                    </div>

                    <div className="actions" ref={ruleFormRef}>
                        <h3>{editingRuleId ? '编辑规则' : '添加新规则'}</h3>
                        <div className="form-group">
                            <label htmlFor="newKeyword">关键字</label>
                            <input type="text" id="newKeyword" value={newKeyword} onChange={e => setNewKeyword(e.target.value)} placeholder="请求内容中包含的文本" />
                        </div>
                        <div className="form-group">
                            <label htmlFor="newResponse">特定响应</label>
                            <textarea id="newResponse" value={newResponse} onChange={e => setNewResponse(e.target.value)} placeholder="如果找到关键字，返回此内容"></textarea>
                        </div>
                        <button onClick={handleRuleSubmit} disabled={!isEditMode} className="btn btn-primary">{editingRuleId ? '更新规则' : '添加规则'}</button>
                        {editingRuleId && (
                            <button onClick={handleCancelEdit} className="btn btn-secondary">取消编辑</button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ConfigForm;