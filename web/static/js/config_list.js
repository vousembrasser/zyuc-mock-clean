const statusMessage = document.getElementById('status-message');
const configsTableBody = document.querySelector('#configs-table tbody');
const projectFilter = document.getElementById('project-filter');
const searchBox = document.getElementById('search-box');

let allConfigs = [];

function showStatus(message, type, autoHide = false) {
    statusMessage.textContent = message;
    statusMessage.className = type;
    statusMessage.style.display = 'block';
    if (autoHide) {
        setTimeout(() => { statusMessage.style.display = 'none'; }, 3000);
    }
}

function renderTable(configs) {
    configsTableBody.innerHTML = ''; // Clear existing rows

    if (!configs || configs.length === 0) {
        configsTableBody.innerHTML = '<tr><td colspan="3" style="text-align: center;">未找到匹配的配置。</td></tr>';
        return;
    }

    const groupedByProject = configs.reduce((acc, config) => {
        const project = config.Project || '未分类';
        if (!acc[project]) {
            acc[project] = [];
        }
        acc[project].push(config);
        return acc;
    }, {});

    for (const project in groupedByProject) {
        const projectHeaderRow = document.createElement('tr');
        projectHeaderRow.className = 'project-header';
        projectHeaderRow.innerHTML = `<td colspan="3">${escapeHtml(project)}</td>`;
        configsTableBody.appendChild(projectHeaderRow);

        groupedByProject[project].forEach(config => {
            const row = document.createElement('tr');
            const responsePreview = config.DefaultResponse.length > 150 
                ? config.DefaultResponse.substring(0, 150) + '...'
                : config.DefaultResponse;

            // --- 变更开始 ---
            // 将 "actions" 类从 <td> 移至内部的 <div>。
            // 这可以防止直接将 flexbox 应用于表格单元格，因为这可能导致布局不一致。
            // <td> 现在将作为标准表格单元格，正确地遵循行高。
            row.innerHTML = `
                <td class="endpoint-cell">
                    <div>${escapeHtml(config.Endpoint)}</div>
                    <div class="remark">${escapeHtml(config.Remark || '无备注')}</div>
                </td>
                <td><pre>${escapeHtml(responsePreview)}</pre></td>
                <td>
                    <div class="actions">
                        <a href="/web/config_edit.html?endpoint=${encodeURIComponent(config.Endpoint)}" class="edit-btn">编辑</a>
                        <button class="delete-btn" data-endpoint="${config.Endpoint}">删除</button>
                    </div>
                </td>
            `;
            // --- 变更结束 ---
            configsTableBody.appendChild(row);
        });
    }
}

function applyFilters() {
    const project = projectFilter.value;
    const searchTerm = searchBox.value.toLowerCase();

    const filteredConfigs = allConfigs.filter(config => {
        const projectMatch = !project || (config.Project || '未分类') === project;
        const searchMatch = !searchTerm || 
            config.Endpoint.toLowerCase().includes(searchTerm) ||
            (config.Remark && config.Remark.toLowerCase().includes(searchTerm));
        return projectMatch && searchMatch;
    });

    renderTable(filteredConfigs);
}

function loadConfigs() {
    fetch('/api/configs')
        .then(res => res.json())
        .then(configs => {
            allConfigs = configs || [];

            // Populate project filter
            const projects = [...new Set(allConfigs.map(c => c.Project || '未分类'))];
            projectFilter.innerHTML = '<option value="">所有工程</option>'; // Reset
            projects.sort().forEach(p => {
                const option = document.createElement('option');
                option.value = p;
                option.textContent = p;
                projectFilter.appendChild(option);
            });

            renderTable(allConfigs);
        })
        .catch(err => {
            console.error('Failed to load configs:', err);
            configsTableBody.innerHTML = '<tr><td colspan="3" style="text-align: center; color: red;">加载配置失败。</td></tr>';
        });
}

configsTableBody.addEventListener('click', (event) => {
    if (event.target.classList.contains('delete-btn')) {
        const endpoint = event.target.dataset.endpoint;
        if (confirm(`确定要删除接口 "${endpoint}" 的配置吗？此操作不可恢复。`)) {
            showStatus('正在删除...', 'success');
            fetch(`/api/config${endpoint}`, { method: 'DELETE' })
                .then(res => res.ok ? res.json() : res.json().then(err => Promise.reject(err)))
                .then(() => {
                    showStatus('配置已成功删除！', 'success', true);
                    loadConfigs(); // Reload all data
                })
                .catch(err => showStatus(`删除失败: ${err.error || '未知错误'}`, 'error'));
        }
    }
});

function escapeHtml(unsafe) {
    if (!unsafe) return '';
    return unsafe.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

// Initial load and event listeners
document.addEventListener('DOMContentLoaded', loadConfigs);
projectFilter.addEventListener('change', applyFilters);
searchBox.addEventListener('input', applyFilters);