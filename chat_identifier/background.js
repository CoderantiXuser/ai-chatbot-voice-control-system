// background.js v2.3 (with Centralized, Race-Safe Logging)

const GATEWAY_URL = 'http://127.0.0.1:5000';

// Import the local Socket.IO client library
try {
  importScripts('lib/socket.io.min.js');
} catch (e) {
  console.error(e);
}

// Establish a connection to the gateway server
const socket = io(GATEWAY_URL, {
  // Recommended options for Chrome extensions
  transports: ['websocket'],
  reconnectionAttempts: 5,
  reconnectionDelay: 1000,
});

socket.on('connect', () => {
  logEvent({ source: 'background.js', event: 'Socket.IO', details: 'Connected to gateway.', status: 'Info', triggerId: 'socket_connect', level: LOG_LEVELS.INFO });
});

socket.on('disconnect', (reason) => {
  logEvent({ source: 'background.js', event: 'Socket.IO', details: `Disconnected from gateway: ${reason}`, status: 'Warn', triggerId: 'socket_disconnect', level: LOG_LEVELS.WARN });
});

socket.on('connect_error', (error) => {
  logEvent({ source: 'background.js', event: 'Socket.IO', details: `Connection error: ${error.message}`, status: 'Error', triggerId: 'socket_connect_error', level: LOG_LEVELS.ERROR });
});

// Listen for real-time ASR results from the gateway
socket.on('asr_result', (data) => {
  if (data && data.text) {
    // Find the active tab in the current window and send the ASR text to it.
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs.length > 0) {
        chrome.tabs.sendMessage(tabs[0].id, {
          action: 'asr_result_push',
          text: data.text
        }, (response) => {
          if (chrome.runtime.lastError) {
            // This can happen if the content script is not ready or has been unloaded.
            // We log this as a warning because it's not a critical failure of the extension.
            logEvent({
              source: 'background.js',
              event: 'ASR Push',
              details: `Could not send ASR result to tab ${tabs[0].id}: ${chrome.runtime.lastError.message}`,
              status: 'Warn',
              triggerId: 'asr_push_error',
              level: LOG_LEVELS.WARN
            });
          }
        });
      }
    });
  }
});

// --- LOGGING LEVELS ---
const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
  CRITICAL: 4
};

// --- CENTRALIZED LOGGING (Race-Condition Safe) ---

let isProcessingLogs = false;
const logQueue = [];

/**
 * Adds a log entry to a queue and ensures the processing task is running.
 * This function is synchronous and safe to call from any context.
 * @param {object} logEntry - The log entry object.
 */
function logEvent(logEntry) {
    // Emit the log entry to the gateway server
    // Socket.IO communication removed due to Manifest V3 CSP. If needed, bundle locally.
    // if (socket.connected) {
    //     socket.emit('extension_log', logEntry);
    // } else {
    //     console.warn('Socket.IO not connected, queuing log locally:', logEntry);
    // }
    logQueue.push(logEntry);
    if (!isProcessingLogs) {
        processLogQueue();
    }
}

/**
 * Processes the log queue, writing entries to storage in a serialized manner
 * to prevent race conditions and data loss.
 */
async function processLogQueue() {
    if (isProcessingLogs || logQueue.length === 0) {
        return;
    }
    isProcessingLogs = true;

    // Process all items currently in the queue in a single batch.
    const itemsToProcess = [...logQueue];
    logQueue.length = 0; // Clear the queue for new incoming logs.

    try {
        const { logs = [] } = await chrome.storage.local.get('logs');

        // Add the new entries to the beginning of the logs array.
        for (const entry of itemsToProcess.reverse()) { // Reverse to maintain order when unshifting
            const level = entry.level !== undefined ? entry.level : LOG_LEVELS.INFO;
            const fullData = entry.fullData && typeof entry.fullData === 'object' ? entry.fullData : {};
            logs.unshift({ timestamp: new Date().toISOString(), ...entry, level, fullData });
        }

        // Prune old logs to prevent storage from filling up (LIFO)
        if (logs.length > 200) {
            logs.length = 200;
        }
        
        await chrome.storage.local.set({ logs });

    } catch (e) {
        console.error("Error writing to log storage:", e);
    } finally {
        isProcessingLogs = false;
        // If more logs came in while processing, run again.
        // Using setTimeout avoids potential deep recursion ("Maximum call stack size exceeded").
        if (logQueue.length > 0) {
            setTimeout(processLogQueue, 0); 
        }
    }
}


// --- SERVER STATUS BADGE ---

/**
 * Updates the server status badge text and color based on gateway connectivity.
 */
async function updateServerStatus() {
  try {
    const response = await fetch(`${GATEWAY_URL}/api/status`);
    if (response.ok) {
      chrome.action.setBadgeText({ text: 'ON' });
      chrome.action.setBadgeBackgroundColor({ color: '#22c55e' }); // Green
      logEvent({ source: 'background.js', event: 'Server Status', details: 'Gateway is online.', status: 'Info', triggerId: 'updateServerStatus_online', level: LOG_LEVELS.INFO });
    } else {
      chrome.action.setBadgeText({ text: 'ERR' });
      chrome.action.setBadgeBackgroundColor({ color: '#ef4444' }); // Red
      logEvent({ source: 'background.js', event: 'Server Status', details: `Gateway returned non-OK status: ${response.status}`, status: 'Error', triggerId: 'updateServerStatus_nonOkResponse', level: LOG_LEVELS.ERROR, fullData: { responseStatus: response.status } });
    }
  } catch (error) {
    chrome.action.setBadgeText({ text: 'OFF' });
    chrome.action.setBadgeBackgroundColor({ color: '#ef4444' }); // Red
    logEvent({ source: 'background.js', event: 'Server Status', details: `Gateway connection failed: ${error.message}`, status: 'Error', triggerId: 'updateServerStatus_fetchError', level: LOG_LEVELS.ERROR, fullData: { errorMessage: error.message } });
  }
}

// --- TTS REQUEST PROXY ---

let ttsQueue = [];
let isPlaying = false;

/**
 * Processes the TTS queue, playing audio sequentially.
 */
async function processTtsQueue() {
  if (ttsQueue.length === 0 || isPlaying) {
    return;
  }

  isPlaying = true;
  const { payload, sendResponse } = ttsQueue.shift();

  try {
    const { playInBrowser } = await chrome.storage.local.get({ playInBrowser: false });

    // Start with the base request body
    const requestBody = {
        text: payload.text,
        model: payload.model
    };

    // Dynamically add optional parameters from the payload if they exist
    const optionalParams = [
        'speaker_id', 
        'length_scale', 
        'noise_scale', 
        'noise_w', 
        'sentence_silence'
    ];

    optionalParams.forEach(param => {
        if (payload[param] !== null && payload[param] !== undefined) {
            requestBody[param] = payload[param];
        }
    });

    const response = await fetch(`${GATEWAY_URL}/api/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
        throw new Error(`Gateway returned status: ${response.status}`);
    }

    if (playInBrowser) {
        // If playing in browser, get audio blob and send as Data URL
        const audioBlob = await response.blob();
        const reader = new FileReader();
        reader.onloadend = () => {
            sendResponse({ success: true, audioDataUrl: reader.result });
        };
        reader.onerror = (e) => {
            logEvent({ source: 'background.js', event: 'TTS Blob Read Error', details: `Failed to read audio blob: ${e.message}`, status: 'Error', triggerId: 'processTtsQueue_blobReadError', level: LOG_LEVELS.ERROR, fullData: { errorMessage: e.message } });
            sendResponse({ success: false, error: `Failed to read audio blob: ${e.message}` });
        };
        reader.readAsDataURL(audioBlob);
    } else {
        // If not playing in browser, assume gateway handles playback and just send success
        sendResponse({ success: true });
    }
  } catch (error) {
    logEvent({ source: 'background.js', event: 'TTS Request', details: `TTS request failed: ${error.message}`, status: 'Error', triggerId: 'processTtsQueue_requestError', level: LOG_LEVELS.ERROR, fullData: { errorMessage: error.message } });
    sendResponse({ success: false, error: error.message });
  } finally {
    isPlaying = false;
    processTtsQueue(); // Process next item in queue
  }
}

/**
 * Handles incoming TTS requests by adding them to a queue.
 * @param {object} payload - The TTS request payload.
 * @param {function} sendResponse - The function to send a response back to the sender.
 */
async function handleTtsRequest(payload, sendResponse) {
  if (!payload || !payload.text || !payload.model) {
    const errorMsg = 'Invalid payload for TTS request.';
    logEvent({ source: 'background.js', event: 'TTS Request', details: errorMsg, status: 'Error', triggerId: 'handleTtsRequest_invalidPayload', level: LOG_LEVELS.ERROR, fullData: { payload: payload } });
    sendResponse({ success: false, error: errorMsg });
    return;
  }

  ttsQueue.push({ payload, sendResponse });
  processTtsQueue();
}

// --- EVENT LISTENERS ---

// Listener for all incoming messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'ttsRequest') {
    handleTtsRequest(message.payload, sendResponse);
    return true; // Indicates an asynchronous response.
  }
  if (message.action === 'logEvent') {
    logEvent(message.payload);
    // No response is sent, and logEvent is now synchronous (it just queues the work),
    // so `return true` is not strictly necessary but doesn't hurt.
    // The async processing is now safely decoupled.
  }
  if (message.action === 'stateUpdate') {
    // Store the recent message for options page preview
    chrome.storage.local.set({ lastBotMessageForPreview: message.data.recentMessage });
  } else if (message.action === 'openLogsPage') {
    chrome.tabs.query({ url: chrome.runtime.getURL('logs.html') }, (tabs) => {
      if (tabs.length > 0) {
        chrome.tabs.update(tabs[0].id, { active: true });
      } else {
        chrome.tabs.create({ url: chrome.runtime.getURL('logs.html') });
      }
    });
  } else if (message.action === 'openOptionsPage') {
    chrome.runtime.openOptionsPage();
  } else if (message.action === 'openPopupPage') {
    // For popup, we just close the current window, and the user can click the extension icon again.
    // Or, if it's a tab, navigate to it.
    chrome.tabs.query({ url: chrome.runtime.getURL('popup.html') }, (tabs) => {
      if (tabs.length > 0) {
        chrome.tabs.update(tabs[0].id, { active: true });
      } else {
        // If popup is not open as a tab, do nothing, as it's a browser action popup.
        // The user will click the extension icon to open it.
      }
    });
  }
});

/**
 * Listener for when the extension is installed or updated.
 * Initializes server status and sets up a periodic alarm for status checks.
 */
chrome.runtime.onInstalled.addListener(() => {
  logEvent({ source: 'background.js', event: 'Extension Event', details: 'Installed or Updated.', status: 'Info', triggerId: 'background_onInstalled', level: LOG_LEVELS.INFO });
  updateServerStatus();
  chrome.alarms.create('statusCheck', {
    delayInMinutes: 0.1,
    periodInMinutes: 0.5 // Check every 30 seconds
  });
});

/**
 * Listener for when an alarm fires.
 * @param {object} alarm - The alarm object.
 */
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'statusCheck') {
    updateServerStatus();
  }
});

/**
 * Listener for when the browser starts up.
 * Updates the server status.
 */
chrome.runtime.onStartup.addListener(() => {
    updateServerStatus();
});