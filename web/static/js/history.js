const statusMessage = document.getElementById('status-message');
const historyTableBody = document.querySelector('#history-table tbody');
const projectFilter = document.getElementById('project-filter');
const searchBox = document.getElementById('search-box');
const paginationContainer = document.querySelector('.pagination');

let currentPage = 1;
const pageSize = 20;

function escapeHtml(unsafe) {
    if (!unsafe) return '';
    return unsafe.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function showStatus(message, type, autoHide = false) {
    statusMessage.textContent = message;
    statusMessage.className = type;
    statusMessage.style.display = 'block';
    if (autoHide) {
        setTimeout(() => { statusMessage.style.display = 'none'; }, 3000);
    }
}

function renderTable(events) {
    historyTableBody.innerHTML = '';
    if (!events || events.length === 0) {
        historyTableBody.innerHTML = '<tr><td colspan="4" style="text-align: center;">未找到历史记录。</td></tr>';
        return;
    }

    events.forEach(event => {
        const row = document.createElement('tr');
        const statusClass = event.Status.replace(/[\s()]/g, '-');
        row.innerHTML = `
            <td class="endpoint-cell">
                <div>${escapeHtml(event.Endpoint)}</div>
                <div class="project">${escapeHtml(event.Project || '未分类')}</div>
            </td>
            <td><pre>${escapeHtml(event.Payload)}</pre></td>
            <td><pre>${escapeHtml(event.ResponseBody)}</pre></td>
            <td class="status-cell">
                <span class="status status-${statusClass}">${escapeHtml(event.Status)}</span>
                <span class="timestamp">${new Date(event.Timestamp).toLocaleString()}</span>
            </td>
        `;
        historyTableBody.appendChild(row);
    });
}

function renderPagination(total, page, pageSize) {
    paginationContainer.innerHTML = '';
    const totalPages = Math.ceil(total / pageSize);

    if (totalPages <= 1) return;

    const prevButton = document.createElement('button');
    prevButton.textContent = '上一页';
    prevButton.disabled = page <= 1;
    prevButton.addEventListener('click', () => {
        currentPage--;
        loadHistory();
    });

    const pageInfo = document.createElement('span');
    pageInfo.className = 'page-info';
    pageInfo.textContent = `第 ${page} / ${totalPages} 页`;

    const nextButton = document.createElement('button');
    nextButton.textContent = '下一页';
    nextButton.disabled = page >= totalPages;
    nextButton.addEventListener('click', () => {
        currentPage++;
        loadHistory();
    });

    paginationContainer.appendChild(prevButton);
    paginationContainer.appendChild(pageInfo);
    paginationContainer.appendChild(nextButton);
}

function loadHistory() {
    const project = projectFilter.value;
    const search = searchBox.value;
    const url = `/api/history?page=${currentPage}&pageSize=${pageSize}&project=${encodeURIComponent(project)}&search=${encodeURIComponent(search)}`;

    fetch(url)
        .then(res => res.json())
        .then(data => {
            renderTable(data.data);
            renderPagination(data.total, data.page, data.pageSize);
        })
        .catch(err => {
            console.error('Failed to load history:', err);
            showStatus('加载历史记录失败。', 'error');
        });
}

function populateProjectFilter() {
    fetch('/api/configs')
        .then(res => res.json())
        .then(configs => {
            const projects = [...new Set((configs || []).map(c => c.Project || ''))].filter(Boolean);
            projectFilter.innerHTML = '<option value="">所有工程</option>';
            projects.sort().forEach(p => {
                const option = document.createElement('option');
                option.value = p;
                option.textContent = p;
                projectFilter.appendChild(option);
            });
        });
}

function debounce(func, delay) {
    let timeout;
    return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), delay);
    };
}

document.addEventListener('DOMContentLoaded', () => {
    populateProjectFilter();
    loadHistory();
});

projectFilter.addEventListener('change', () => {
    currentPage = 1;
    loadHistory();
});

searchBox.addEventListener('input', debounce(() => {
    currentPage = 1;
    loadHistory();
}, 300));