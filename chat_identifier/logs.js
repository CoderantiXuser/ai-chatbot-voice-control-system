// logs.js
document.addEventListener('DOMContentLoaded', () => {
    // --- LOGGING LEVELS (Mirroring background.js) ---
    const LOG_LEVELS = {
      DEBUG: 0,
      INFO: 1,
      WARN: 2,
      ERROR: 3,
      CRITICAL: 4
    };

    const logBody = document.getElementById('log-body');
    const clearButton = document.getElementById('clear-logs-button');
    const refreshButton = document.getElementById('refresh-logs-button');
    const filterInput = document.getElementById('filter-input');
    const filterStatusSelect = document.getElementById('filter-status-select');
    const filterLevelSelect = document.getElementById('filter-level-select');
    const downloadButton = document.getElementById('download-logs-button');
    const statusMessageDiv = document.getElementById('status-message');

    let statusMessageTimeoutId;
    function showStatusMessage(message, type = 'info', duration = 3000, level = LOG_LEVELS.INFO, fullData = {}) {
        statusMessageDiv.textContent = message;
        statusMessageDiv.className = `status-message ${type} show`;

        if (statusMessageTimeoutId) {
            clearTimeout(statusMessageTimeoutId);
        }
        statusMessageTimeoutId = setTimeout(() => {
            statusMessageDiv.classList.remove('show');
            setTimeout(() => {
                statusMessageDiv.textContent = '';
                statusMessageDiv.className = 'status-message';
            }, 300);
        }, duration);

        // Optionally log this status message to persistent storage if it's an error or critical info
        if (level >= LOG_LEVELS.ERROR) {
            chrome.runtime.sendMessage({
                action: 'logEvent',
                payload: { source: 'logs.js', event: 'UI Status', details: message, status: type, trigger: 'showStatusMessage', level: level, fullData: fullData }
            });
        }
    }

    const renderLogs = (logs) => {
        logBody.innerHTML = '';

        if (!logs || logs.length === 0) {
            const row = logBody.insertRow();
            const cell = row.insertCell();
            cell.colSpan = 6;
            cell.textContent = 'No log entries found.';
            cell.style.textAlign = 'center';
            cell.style.color = 'var(--color-text-secondary)';
            return;
        }

        const filterText = filterInput.value.toLowerCase();
        const filterStatus = filterStatusSelect.value;
        const filterLevel = parseInt(filterLevelSelect.value, 10);

        const filteredLogs = logs.filter(entry => {
            const matchesText = !filterText || 
                                (entry.source && entry.source.toLowerCase().includes(filterText)) ||
                                (entry.event && entry.event.toLowerCase().includes(filterText)) ||
                                (entry.details && entry.details.toLowerCase().includes(filterText)) ||
                                (entry.triggerId && entry.triggerId.toLowerCase().includes(filterText));
            const matchesStatus = filterStatus === 'all' || (entry.status && entry.status.toLowerCase() === filterStatus);
            const matchesLevel = entry.level >= filterLevel; // Filter by numeric log level
            return matchesText && matchesStatus && matchesLevel;
        });

        if (filteredLogs.length === 0) {
            const row = logBody.insertRow();
            const cell = row.insertCell();
            cell.colSpan = 6;
            cell.textContent = 'No matching log entries found.';
            cell.style.textAlign = 'center';
            cell.style.color = 'var(--color-text-secondary)';
            return;
        }

        filteredLogs.forEach(entry => {
            const row = logBody.insertRow();
            row.insertCell().textContent = new Date(entry.timestamp).toLocaleTimeString();
            row.insertCell().textContent = entry.source || 'N/A';
            row.insertCell().textContent = entry.event || 'N/A';
            row.insertCell().textContent = entry.details || 'N/A';
            
            const statusCell = row.insertCell();
            statusCell.textContent = entry.status || 'N/A';
            if(entry.status) {
                statusCell.classList.add(`status-cell-${entry.status.toLowerCase()}`);
            }
            row.insertCell().textContent = entry.triggerId || 'N/A';
        });
    };

    const loadLogs = async () => {
        try {
            const { logs = [] } = await chrome.storage.local.get('logs');
            renderLogs(logs);
        } catch (e) {
            console.error("Failed to load logs from storage:", e);
            logBody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--color-accent-red);">Error loading logs.</td></tr>';
            showStatusMessage('Error loading logs.', 'error');
        }
    };

    const clearLogs = async () => {
        if (confirm('Are you sure you want to clear all log entries?')) {
            try {
                await chrome.storage.local.set({ logs: [] });
                loadLogs(); // Re-render to show empty state
                showStatusMessage('Logs cleared successfully!', 'success');
            } catch (e) {
                console.error("Failed to clear logs:", e);
                showStatusMessage('Error clearing logs.', 'error', 5000, LOG_LEVELS.ERROR, { errorMessage: e.message });
            }
        }
    };

    const downloadLogs = async () => {
        try {
            const { logs = [] } = await chrome.storage.local.get('logs');
            if (logs.length === 0) {
                showStatusMessage('No logs to download.', 'warn', 3000, LOG_LEVELS.WARN);
                return;
            }

            const dataStr = JSON.stringify(logs, null, 2);
            const blob = new Blob([dataStr], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `voice_gateway_logs_${new Date().toISOString().slice(0,10)}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            showStatusMessage('Logs downloaded successfully!', 'success', 3000, LOG_LEVELS.INFO);
        } catch (e) {
            console.error("Failed to download logs:", e);
            showStatusMessage('Error downloading logs.', 'error', 5000, LOG_LEVELS.ERROR, { errorMessage: e.message });
        }
    };

    clearButton.addEventListener('click', clearLogs);
    refreshButton.addEventListener('click', loadLogs);
    filterInput.addEventListener('input', loadLogs);
    filterStatusSelect.addEventListener('change', loadLogs);
    filterLevelSelect.addEventListener('change', loadLogs);
    downloadButton.addEventListener('click', downloadLogs);

    loadLogs();
});