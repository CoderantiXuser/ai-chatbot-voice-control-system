// popup.js v2.3 (Refactored UI/UX and improved error handling)
document.addEventListener('DOMContentLoaded', () => {
  // --- DOM Element Selection ---
  const analyzerToggle = document.getElementById('analyzer-toggle');
  const ttsToggle = document.getElementById('tts-toggle');
  const asrToggle = document.getElementById('asr-toggle');
  const killSpeechButton = document.getElementById('kill-speech-button');

  const gatewayStatusIndicator = document.getElementById('gateway-status-indicator');
  const gatewayStatusText = document.getElementById('gateway-status-text');
  const asrStatusIndicator = document.getElementById('asr-status-indicator');
  const asrStatusText = document.getElementById('asr-status-text');

  const statsContainer = document.getElementById('stats');
  const recentMessageContainer = document.getElementById('recent-message');
  const statusMessageDiv = document.getElementById('status-message');

  const downloadHistoryButton = document.getElementById('download-history-button');
  const formatSelect = document.getElementById('format-select');

  // --- Configuration ---
  const GATEWAY_URL = 'http://127.0.0.1:5000';
  const STATUS_CHECK_INTERVAL = 5000; // Check all statuses every 5 seconds

  // --- LOGGING LEVELS (Mirroring background.js) ---
  const LOG_LEVELS = {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3,
    CRITICAL: 4
  };

  let statusIntervalId; // To store the interval ID for status checks

  // Helper function to display status messages
  let statusMessageTimeoutId;
  function showStatusMessage(message, type = 'info', duration = 3000) {
    statusMessageDiv.textContent = message;
    statusMessageDiv.className = `status-message ${type} show`; // Add 'show' class for visibility

    if (statusMessageTimeoutId) {
      clearTimeout(statusMessageTimeoutId);
    }
    statusMessageTimeoutId = setTimeout(() => {
      statusMessageDiv.classList.remove('show');
      // Clear text after transition for accessibility
      setTimeout(() => {
        statusMessageDiv.textContent = '';
        statusMessageDiv.className = 'status-message';
      }, 300); // Match CSS transition duration
    }, duration);
  }

  /**
   * Updates the checked state and ARIA attribute for a toggle switch.
   * @param {HTMLElement} toggleElement - The input element of the toggle.
   * @param {boolean} isChecked - The desired checked state.
   */
  function updateToggleUI(toggleElement, isChecked) {
    toggleElement.checked = isChecked;
    toggleElement.closest('.switch').setAttribute('aria-checked', isChecked);
  }

  // =================================================================
  // --- CHAT ANALYZER LOGIC ---
  // =================================================================

  function updateAnalyzerUI(state) {
    if (!state) {
      renderConnectionError();
      return;
    }
    downloadHistoryButton.disabled = false; // Enable on successful connection
    statsContainer.hidden = false;
    statsContainer.querySelector('#user-count').textContent = state.userCount;
    statsContainer.querySelector('#bot-count').textContent = state.botCount;
    statsContainer.querySelector('#total-count').textContent = state.userCount + state.botCount;

    renderRecentMessage(state.recentMessage);
  }

  function renderRecentMessage({ role, html }) {
    recentMessageContainer.className = 'recent-message-content'; // Reset classes
    if (role) {
      recentMessageContainer.classList.add(role);
    }
    recentMessageContainer.innerHTML = html || '—';
  }

  function renderConnectionError() {
    statsContainer.hidden = true;
    downloadHistoryButton.disabled = true; // Disable on error
    const retryHtml = `
      <p>Analyzer not active on this page.</p>
      <button id="retry-button">Retry Connection</button>
    `;
    renderRecentMessage({ role: 'error', html: retryHtml });
    const retryButton = recentMessageContainer.querySelector('#retry-button');
    if (retryButton) {
      retryButton.addEventListener('click', initiateAnalyzerConnection);
    }
  }

  const MAX_RETRIES = 5;
  const RETRY_DELAY_MS = 500; // 500ms

  function initiateAnalyzerConnection(retryCount = 0) {
    renderRecentMessage({ role: 'loading', html: 'Connecting to page...' });
    sendMessageToContentScript({ action: 'ping' },
      (response) => {
        if (response?.status === 'ready') {
          sendMessageToContentScript({ action: 'getData' },
            (state) => state ? updateAnalyzerUI(state) : renderConnectionError(),
            () => renderConnectionError()
          );
        } else {
          renderConnectionError();
        }
      },
      (error) => {
        console.error("Error initiating analyzer connection:", error.message || error);
        if (retryCount < MAX_RETRIES) {
          
          setTimeout(() => initiateAnalyzerConnection(retryCount + 1), RETRY_DELAY_MS);
        } else {
          renderConnectionError();
        }
      }
    );
  }

  // =================================================================
  // --- VOICE GATEWAY LOGIC ---
  // =================================================================

  /**
   * Updates the Gateway status UI elements.
   * @param {boolean} isOnline - True if gateway is online, false otherwise.
   * @param {string} [statusText] - Optional text to display.
   */
  function updateGatewayStatusUI(isOnline, statusText) {
    if (isOnline) {
      gatewayStatusIndicator.className = 'status-indicator-dot online';
      gatewayStatusText.textContent = statusText || 'Online';
    } else {
      gatewayStatusIndicator.className = 'status-indicator-dot offline';
      gatewayStatusText.textContent = statusText || 'Offline';
    }
  }

  /**
   * Updates the ASR UI elements based on the running status.
   * @param {boolean} isRunning - True if ASR is running, false otherwise.
   * @param {string} [statusText] - Optional text to display as the status.
   */
  function updateAsrUI(isRunning, statusText) {
    asrToggle.disabled = false; // Always re-enable button after an update
    updateToggleUI(asrToggle, isRunning);

    if (isRunning) {
      asrStatusIndicator.className = 'status-indicator-dot online';
      asrStatusText.textContent = statusText || 'Listening';
    } else {
      asrStatusIndicator.className = 'status-indicator-dot offline';
      asrStatusText.textContent = statusText || 'Offline';
    }
  }

  /**
   * Checks the current status of the Gateway and ASR service.
   */
  async function checkAllStatuses() {
    try {
      const response = await fetch(`${GATEWAY_URL}/api/status`);
      if (!response.ok) {
        updateGatewayStatusUI(false, 'Disconnected');
        updateAsrUI(false, 'N/A'); // ASR status unknown if gateway is down
        return;
      }
      const data = await response.json();
      updateGatewayStatusUI(true, 'Online');
      updateAsrUI(data.asr_running);
    } catch (error) {
      updateGatewayStatusUI(false, 'Disconnected');
      updateAsrUI(false, 'N/A');
            logEvent('Status Check', `Failed to connect to gateway: ${error.message}`, 'Error', 'checkAllStatuses', LOG_LEVELS.ERROR, { errorMessage: error.message });
    }
  }

  /**
   * Handles the ASR toggle switch change event.
   * Sends a start/stop command to the gateway based on the toggle state.
   * @param {Event} e - The change event object.
   */
  async function handleAsrToggle(e) {
    const shouldBeOn = e.target.checked;
    const endpoint = shouldBeOn ? '/api/asr/start' : '/api/asr/stop';

    let body = {};
    let headers = {};

    if (shouldBeOn) {
      const { selectedVoskModel } = await chrome.storage.local.get('selectedVoskModel');
      if (!selectedVoskModel) {
        showStatusMessage('No VOSK model selected. Please set one in the extension options page.', 'error', 5000);
        logEvent('ASR Toggle', 'No VOSK model selected.', 'Error', 'handleAsrToggle_noModel', LOG_LEVELS.ERROR, { selectedVoskModel: selectedVoskModel });
        updateToggleUI(asrToggle, false); // Revert toggle
        return;
      }
      body = JSON.stringify({ model: selectedVoskModel });
      headers = { 'Content-Type': 'application/json' };
    }

    try {
      asrToggle.disabled = true;
      updateAsrUI(shouldBeOn, 'SENDING...');
      await fetch(`${GATEWAY_URL}${endpoint}`, { method: 'POST', headers, body });
      logEvent('ASR Toggle', `Command sent: ${shouldBeOn ? 'Start' : 'Stop'}.`, 'Success', 'handleAsrToggle');
      // Inform content script to start/stop polling
      sendMessageToContentScript({ action: shouldBeOn ? 'startAsrPolling' : 'stopAsrPolling' });
      await checkAllStatuses(); // Re-check status immediately after command.
    } catch (error) {
      logEvent('ASR Toggle', `Failed to send command: ${error.message}`, 'Error', 'handleAsrToggle_sendFailed');
      showStatusMessage('Could not send command to gateway. Is it running?', 'error', 5000);
      await checkAllStatuses(); // Update UI to disconnected state.
    }
  }

  // =================================================================
  // --- INITIALIZATION & EVENT LISTENERS ---
  // =================================================================

  // Load persistent toggle states from storage.
  chrome.storage.local.get({
    isAnalyzerEnabled: true,
    isTtsEnabled: true
  }, ({ isAnalyzerEnabled, isTtsEnabled }) => {
    updateToggleUI(analyzerToggle, isAnalyzerEnabled);
    updateToggleUI(ttsToggle, isTtsEnabled);
  });

  // Analyzer Toggle
  analyzerToggle.addEventListener('change', (e) => {
    const isEnabled = e.target.checked;
    chrome.storage.local.set({ isAnalyzerEnabled: isEnabled });
    sendMessageToContentScript({ action: isEnabled ? 'enableAnalyzer' : 'disableAnalyzer' });
    updateToggleUI(analyzerToggle, isEnabled);
  });

  // TTS Toggle
  ttsToggle.addEventListener('change', (e) => {
    const isEnabled = e.target.checked;
    chrome.storage.local.set({ isTtsEnabled: isEnabled });
    logEvent('TTS Toggle', `Auto-speak set to ${isEnabled}.`, 'Info', 'ttsToggleChange');
    updateToggleUI(ttsToggle, isEnabled);
  });

  // ASR Toggle
  asrToggle.addEventListener('change', handleAsrToggle);

  // Kill Speech Button
  killSpeechButton.addEventListener('click', async () => {
    killSpeechButton.disabled = true; // Disable button immediately
    try {
      const response = await fetch(`${GATEWAY_URL}/api/tts/stop`, { method: 'POST' });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      logEvent('Kill Speech', 'TTS stop command sent.', 'Success', 'killSpeechButton_success');
      showStatusMessage('TTS stopped.', 'success');
      killSpeechButton.disabled = false; // Re-enable button
    } catch (error) {
      logEvent('Kill Speech', `Failed to send TTS stop command: ${error.message}`, 'Error', 'killSpeechButton_sendFailed', LOG_LEVELS.ERROR, { errorMessage: error.message });
      showStatusMessage('Could not send TTS stop command. Is the gateway running?', 'error', 5000);
      killSpeechButton.disabled = false; // Re-enable button
    }
  });

  // Listens for live stat updates pushed from the content script.
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'stateUpdate') {
      updateAnalyzerUI(msg.data);
    }
  });

  /**
   * Sends a message to the active content script.
   * @param {object} message - The message payload.
   * @param {function} [onSuccess] - Callback for successful response.
   * @param {function} [onError] - Callback for error response.
   */
  function sendMessageToContentScript(message, onSuccess, onError) {
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      if (!tab?.id || !(tab.url?.startsWith('http://') || tab.url?.startsWith('https://'))) {
        const error = new Error("No active web page tab found or tab is not HTTP/HTTPS.");
        onError?.(error);
        logEvent('Content Script Comms', error.message, 'Error', 'sendMessageToContentScript_noTab', LOG_LEVELS.ERROR, { errorMessage: error.message, tab: tab });
        return;
      }
      chrome.tabs.sendMessage(tab.id, message, (response) => {
        if (chrome.runtime.lastError) {
          const error = chrome.runtime.lastError;
          onError?.(error);
          logEvent('Content Script Comms', `Error sending message: ${error.message}`, 'Error', 'sendMessageToContentScript_sendError', LOG_LEVELS.ERROR, { errorMessage: error.message, tabId: tab.id, tabUrl: tab.url });
        } else {
          onSuccess?.(response);
        }
      });
    });
  }

  /**
   * Logs an event to the background script for persistent storage.
   * @param {string} event - The name of the event.
   * @param {string} details - Detailed description of the event.
   * @param {string} status - The status of the event (e.g., 'Success', 'Error', 'Info').
   * @param {string} [trigger='N/A'] - The function or component that triggered the event.
   * @param {number} [level=LOG_LEVELS.INFO] - The log level (DEBUG, INFO, WARN, ERROR, CRITICAL).
   */
  function logEvent(event, details, status, trigger = 'N/A', level = LOG_LEVELS.INFO) {
     chrome.runtime.sendMessage({
        action: 'logEvent',
        payload: { source: 'popup.js', event, details, status, trigger, level }
    });
  }

  // --- Final Initialization on Popup Open ---
  initiateAnalyzerConnection(); // Connect to content script for stats
  checkAllStatuses(); // Check both gateway and ASR status

  // Start periodic status check when popup is open
  statusIntervalId = setInterval(checkAllStatuses, STATUS_CHECK_INTERVAL);

  // Handle navigation to options and logs pages
  document.getElementById('options-link').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.sendMessage({ action: 'openOptionsPage' });
  });

  document.getElementById('logs-link').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.sendMessage({ action: 'openLogsPage' });
  });

  // Download History Button
  downloadHistoryButton.addEventListener('click', () => {
    showStatusMessage('Preparing download...', 'info');
    downloadHistoryButton.disabled = true;
    downloadHistoryButton.textContent = 'Working...';

    sendMessageToContentScript(
      {
        action: 'request_chat_history',
        format: formatSelect.value
      },
      (response) => {
        // The content script will send the data to the background script,
        // so we just need to know if the request was received.
        if (response && response.success) {
          showStatusMessage('History sent to background for download.', 'success');
        } else {
          showStatusMessage(`Failed to get history: ${response?.error || 'Unknown error'}`, 'error');
        }
        downloadHistoryButton.disabled = false;
        downloadHistoryButton.textContent = 'Download';
      },
      (error) => {
        showStatusMessage(`Error communicating with page: ${error.message}`, 'error');
        downloadHistoryButton.disabled = false;
        downloadHistoryButton.textContent = 'Download';
      }
    );
  });

  // Clear interval when popup is closed or becomes inactive
  window.addEventListener('beforeunload', () => {
    clearInterval(statusIntervalId);
  });
});