'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import useSWR from 'swr';
import { fetcher } from '../lib/utils';

function getApiBaseUrl(): string {
    if (typeof window !== 'undefined' && (window as any).APP_CONFIG) {
        return (window as any).APP_CONFIG.apiBaseUrl || 'http://localhost:8080';
    }
    return 'http://localhost:8080';
}

const SshConfigForm = () => {
    const router = useRouter();
    const searchParams = useSearchParams();
    const commandToEdit = searchParams.get('command');

    const [isEditMode, setIsEditMode] = useState(!!commandToEdit);

    const swrKey = commandToEdit ? `/api/ssh/config/${encodeURIComponent(commandToEdit)}` : null;
    const { data: config, error } = useSWR(swrKey, fetcher);

    const [commandInput, setCommandInput] = useState(commandToEdit || '');
    const [project, setProject] = useState('');
    const [remark, setRemark] = useState('');
    const [response, setResponse] = useState('');
    const [statusMessage, setStatusMessage] = useState({ text: '', type: '' });

    useEffect(() => {
        if (isEditMode && config) {
            setProject(config.Project || '');
            setRemark(config.Remark || '');
            setResponse(config.Response || '');
            setCommandInput(config.Command || '');
        }
    }, [isEditMode, config]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setStatusMessage({ text: '正在保存...', type: 'info' });

        const API_BASE_URL = getApiBaseUrl();
        try {
            const res = await fetch(`${API_BASE_URL}/api/ssh/config`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ command: commandInput, project, remark, response }),
            });

            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.error || '保存失败');
            }

            setStatusMessage({ text: '配置已成功保存！', type: 'success' });

            if (!isEditMode) {
                router.push('/ssh-configs');
            }

        } catch (err: any) {
            setStatusMessage({ text: `错误: ${err.message}`, type: 'error' });
        }
    };

    if (isEditMode && error) return <div>加载配置失败...</div>;
    if (isEditMode && !config) return <div>正在加载配置...</div>;

    return (
        <div className="main-config-panel">
            <form id="config-form" onSubmit={handleSubmit}>
                <h1>{isEditMode ? '编辑 SSH 命令配置' : '添加新 SSH 命令配置'}</h1>
                <div className="form-group">
                    <label htmlFor="project">所属工程 (Project)</label>
                    <input type="text" id="project" value={project} onChange={e => setProject(e.target.value)} placeholder="例如：服务器管理" />
                </div>
                <div className="form-group">
                    <label htmlFor="remark">备注 (Remark)</label>
                    <input type="text" id="remark" value={remark} onChange={e => setRemark(e.target.value)} placeholder="例如：查看系统日志命令" />
                </div>
                <div className="form-group">
                    <label htmlFor="command">命令 (Command)</label>
                    <input type="text" id="command" value={commandInput} onChange={e => setCommandInput(e.target.value)} readOnly={isEditMode} placeholder="ls -l /var/log" required />
                </div>
                <div className="form-group">
                    <label htmlFor="response">响应内容</label>
                    <textarea id="response" value={response} onChange={e => setResponse(e.target.value)} placeholder='total 0\n-rw-r--r-- 1 root root 0 Aug  1 10:00 messages' required />
                </div>

                <div className="form-buttons">
                    <button type="submit" className="btn btn-primary">{isEditMode ? '更新配置' : '保存配置'}</button>
                </div>
                {statusMessage.text && (
                    <div id="status-message" className={statusMessage.type}>
                        {statusMessage.text}
                    </div>
                )}
            </form>
        </div>
    );
};

export default SshConfigForm;