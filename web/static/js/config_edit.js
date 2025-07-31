const form = document.getElementById('config-form');
const endpointInput = document.getElementById('endpoint');
const projectInput = document.getElementById('project');
const remarkInput = document.getElementById('remark');
const responseTextarea = document.getElementById('defaultResponse');
const statusMessage = document.getElementById('status-message');
const pageTitle = document.getElementById('page-title');
const submitBtn = form.querySelector('button[type="submit"]');

document.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(window.location.search);
    const endpointToEdit = params.get('endpoint');

    if (endpointToEdit) {
        pageTitle.textContent = '编辑配置';
        submitBtn.textContent = '更新配置';
        endpointInput.value = endpointToEdit;
        endpointInput.readOnly = true;
        loadConfigForEdit(endpointToEdit);
    }
});

function loadConfigForEdit(endpoint) {
    showStatus('正在加载现有配置...', 'success');
    fetch(`/api/config${endpoint}`)
        .then(res => res.ok ? res.json() : res.json().then(err => Promise.reject(err)))
        .then(config => {
            projectInput.value = config.Project || '';
            remarkInput.value = config.Remark || '';
            responseTextarea.value = config.DefaultResponse;
            statusMessage.style.display = 'none';
        })
        .catch(err => showStatus(`加载配置失败: ${err.error || '未知错误'}`, 'error'));
}

form.addEventListener('submit', function(event) {
    event.preventDefault();
    const endpoint = endpointInput.value;
    const project = projectInput.value;
    const remark = remarkInput.value;
    const defaultResponse = responseTextarea.value;

    if (!endpoint.startsWith('/')) {
        showStatus('接口路径必须以 / 开头。', 'error');
        return;
    }

    showStatus('正在保存...', 'success');
    fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint, project, remark, defaultResponse }),
    })
    .then(response => response.ok ? response.json() : response.json().then(err => Promise.reject(err)))
    .then(data => {
        showStatus('配置已成功保存！2秒后将返回列表页...', 'success');
        setTimeout(() => {
            window.location.href = '/web/config.html';
        }, 2000);
    })
    .catch(error => showStatus(`错误: ${error.error || '保存失败，请检查服务日志。'}`, 'error'));
});

function showStatus(message, type) {
    statusMessage.textContent = message;
    statusMessage.className = type;
    statusMessage.style.display = 'block';
}

