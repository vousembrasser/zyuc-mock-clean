'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import useSWR from 'swr';
import { fetcher } from '../lib/utils';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8080';

const ConfigForm = () => {
    const router = useRouter();
    const searchParams = useSearchParams();
    const endpointToEdit = searchParams.get('endpoint');
    const isEditMode = !!endpointToEdit;

    const { data: config, error } = useSWR(
        isEditMode ? `/api/config${endpointToEdit}` : null,
        fetcher
    );

    const [endpoint, setEndpoint] = useState('');
    const [project, setProject] = useState('');
    const [remark, setRemark] = useState('');
    const [defaultResponse, setDefaultResponse] = useState('');
    const [source, setSource] = useState(''); // 新增 state for source
    const [statusMessage, setStatusMessage] = useState({ text: '', type: '' });

    useEffect(() => {
        if (isEditMode && config) {
            setEndpoint(config.Endpoint || '');
            setProject(config.Project || '');
            setRemark(config.Remark || '');
            setDefaultResponse(config.DefaultResponse || '');
            setSource(config.Source || ''); // 填充 source 数据
        }
    }, [isEditMode, config]);


    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!endpoint.startsWith('/')) {
            setStatusMessage({ text: '接口路径必须以 / 开头。', type: 'error' });
            return;
        }
        
        setStatusMessage({ text: '正在保存...', type: 'success' });

        try {
            const res = await fetch(`${API_BASE_URL}/api/config`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ endpoint, project, remark, defaultResponse, source }), // 在请求体中包含 source
            });

            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.error || '保存失败');
            }
            
            setStatusMessage({ text: '配置已成功保存！2秒后将返回列表页...', type: 'success' });
            setTimeout(() => {
                router.push('/configs');
            }, 2000);

        } catch (err: any) {
            setStatusMessage({ text: `错误: ${err.message}`, type: 'error' });
        }
    };

    if (isEditMode && error) return <div>加载配置失败...</div>;
    if (isEditMode && !config) return <div>正在加载配置...</div>;

    return (
        <form id="config-form" onSubmit={handleSubmit}>
            <h1>{isEditMode ? '编辑配置' : '添加新配置'}</h1>
            <div className="form-group">
                <label htmlFor="project">所属工程 (Project)</label>
                <input type="text" id="project" value={project} onChange={e => setProject(e.target.value)} placeholder="例如：用户中心" />
                <small>用于对配置进行分组，可不填。</small>
            </div>
            {/* 新增设备输入框 */}
            <div className="form-group">
                <label htmlFor="source">设备 (Source)</label>
                <input type="text" id="source" value={source} onChange={e => setSource(e.target.value)} placeholder="例如：127.0.0.1:8080" />
                <small>标识此配置主要关联的设备，可不填。</small>
            </div>
            <div className="form-group">
                <label htmlFor="remark">备注 (Remark)</label>
                <input type="text" id="remark" value={remark} onChange={e => setRemark(e.target.value)} placeholder="例如：获取用户信息接口" />
                <small>对此接口配置的简短描述，可不填。</small>
            </div>
            <div className="form-group">
                <label htmlFor="endpoint">接口路径 (Endpoint)</label>
                <input type="text" id="endpoint" value={endpoint} onChange={e => setEndpoint(e.target.value)} readOnly={isEditMode} placeholder="/my/custom/api" required />
                <small>请输入完整的 API 路径，必须以 / 开头。</small>
            </div>
            <div className="form-group">
                <label htmlFor="defaultResponse">默认响应内容</label>
                <textarea id="defaultResponse" value={defaultResponse} onChange={e => setDefaultResponse(e.target.value)} placeholder='<?xml version="1.0"?><response>...</response>' required />
            </div>
            <div className="form-buttons">
                <button type="submit">{isEditMode ? '更新配置' : '保存配置'}</button>
            </div>
            {statusMessage.text && (
                <div id="status-message" className={statusMessage.type} style={{ display: 'block' }}>
                    {statusMessage.text}
                </div>
            )}
        </form>
    );
};

export default ConfigForm;