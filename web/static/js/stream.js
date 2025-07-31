const eventsList = document.getElementById('events');
const projectFilter = document.getElementById('project-filter');
const searchBox = document.getElementById('search-box');

let allEvents = [];
let allProjects = new Set();

// --- The most important line: connect in 'interactive' mode ---
const eventSource = new EventSource('/api/events?mode=interactive');

function escapeHtml(unsafe) {
    if (!unsafe) return '';
    return unsafe.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function applyFilters() {
    const selectedProject = projectFilter.value;
    const searchTerm = searchBox.value.toLowerCase();

    document.querySelectorAll('#events > li').forEach(li => {
        const eventProject = li.dataset.project || '未分类';
        const eventContent = (li.dataset.content || '').toLowerCase();

        const projectMatch = !selectedProject || eventProject === selectedProject;
        const searchMatch = !searchTerm || eventContent.includes(searchTerm);

        if (projectMatch && searchMatch) {
            li.style.display = 'block';
        } else {
            li.style.display = 'none';
        }
    });
}

function updateProjectFilter() {
    const currentSelection = projectFilter.value;
    projectFilter.innerHTML = '<option value="">所有工程</option>';
    const sortedProjects = [...allProjects].sort();
    sortedProjects.forEach(p => {
        const option = document.createElement('option');
        option.value = p;
        option.textContent = p;
        projectFilter.appendChild(option);
    });
    projectFilter.value = currentSelection;
}

eventSource.onopen = function() {
    console.log("Interactive SSE Connection opened successfully.");
    // You can add a status indicator here if needed
};

eventSource.addEventListener('message', function(event) {
    const eventData = JSON.parse(event.data);
    const { requestId, payload, endpoint, defaultResponse, project } = eventData;

    const projectName = project || '未分类';
    if (!allProjects.has(projectName)) {
        allProjects.add(projectName);
        updateProjectFilter();
    }

    const newLi = document.createElement('li');
    newLi.dataset.project = projectName;
    newLi.dataset.content = `${endpoint} ${payload}`;

    const header = document.createElement('div');
    header.className = 'event-header';
    header.innerHTML = `
        <span class="endpoint">请求接口: ${escapeHtml(endpoint)}</span>
        <span>接收于: ${new Date().toLocaleTimeString()}</span>
    `;

    const pre = document.createElement('pre');
    const code = document.createElement('code');
    let displayData;
    let dataType = 'is-text';

    try {
        const jsonData = JSON.parse(payload);
        displayData = JSON.stringify(jsonData, null, 2);
        dataType = 'is-json';
    } catch (e) {
        displayData = payload;
    }

    newLi.classList.add('new-event-highlight', dataType);
    code.textContent = displayData;
    pre.appendChild(code);

    newLi.appendChild(header);
    newLi.appendChild(pre);

    // --- Response Editor Logic ---
    const editorContainer = document.createElement('div');
    editorContainer.className = 'response-editor';

    const responseTextarea = document.createElement('textarea');
    responseTextarea.value = defaultResponse;

    const controlsDiv = document.createElement('div');
    controlsDiv.className = 'controls';

    const buttonsDiv = document.createElement('div');
    buttonsDiv.className = 'buttons';

    const statusP = document.createElement('p');
    statusP.className = 'status';
    statusP.textContent = '将在 3 秒后自动返回默认内容...';

    const sendCustomBtn = document.createElement('button');
    sendCustomBtn.className = 'custom-btn';
    sendCustomBtn.textContent = '返回自定义内容';

    const sendDefaultBtn = document.createElement('button');
    sendDefaultBtn.className = 'default-btn';
    sendDefaultBtn.textContent = '返回默认值';

    buttonsDiv.appendChild(sendCustomBtn);
    buttonsDiv.appendChild(sendDefaultBtn);
    controlsDiv.appendChild(statusP);
    controlsDiv.appendChild(buttonsDiv);

    editorContainer.appendChild(responseTextarea);
    editorContainer.appendChild(controlsDiv);
    newLi.appendChild(editorContainer);

    const sendResponse = (responseContent) => {
        clearTimeout(timerId);
        responseTextarea.readOnly = true;
        responseTextarea.style.backgroundColor = '#f1f3f5';
        sendCustomBtn.disabled = true;
        sendDefaultBtn.disabled = true;
        statusP.textContent = `⏳ 正在发送响应...`;
        statusP.style.color = '#6c757d';

        fetch('/api/respond', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                requestId: requestId,
                responseBody: responseContent,
            }),
        })
        .then(response => response.ok ? response.json() : response.json().then(err => Promise.reject(err)))
        .then(data => {
            statusP.textContent = `✔ 响应已成功发送。`;
            statusP.style.color = 'green';
        })
        .catch(error => {
            statusP.textContent = `❌ 发送失败: ${error.error || '无法发送响应。'}`;
            statusP.style.color = '#dc3545';
        });
    };

    let timerId = setTimeout(() => sendResponse(defaultResponse), 3000);

    responseTextarea.addEventListener('input', () => {
        clearTimeout(timerId);
        statusP.textContent = '已取消自动返回，请手动操作。';
        statusP.style.color = '#6c757d';
    }, { once: true });

    sendCustomBtn.addEventListener('click', () => sendResponse(responseTextarea.value));
    sendDefaultBtn.addEventListener('click', () => sendResponse(defaultResponse));

    setTimeout(() => newLi.classList.remove('new-event-highlight'), 1500);

    eventsList.prepend(newLi);
    applyFilters(); // Re-apply filters to show or hide the new event
});

eventSource.onerror = function(err) {
    console.error("Interactive SSE connection error:", err);
    // You can add a status indicator here if needed
};

projectFilter.addEventListener('change', applyFilters);
searchBox.addEventListener('input', applyFilters);