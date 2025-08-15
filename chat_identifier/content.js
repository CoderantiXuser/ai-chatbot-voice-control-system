// content.js v3.1 (Fixed Syntax Errors and Improved Logic)
(function() {
  'use strict';

  // --- 1. CONFIGURATION AND STATE ---
  const LOG_LEVELS = {
    DEBUG: 'debug',
    INFO: 'info',
    WARN: 'warn',
    ERROR: 'error'
  };
  let isInitialScan = true;
  let asrPollingInterval = null;
  const ASR_POLLING_INTERVAL_MS = 500; // Poll every 500ms
  const GATEWAY_URL = 'http://127.0.0.1:5000';

  const SITE_CONFIG = {
    // IMPORTANT: Keep these selectors updated as website structures may change.
    // Use browser developer tools to inspect elements and update selectors if chat analysis stops working.
    'chatgpt.com':{userSelector:['div[data-message-author-role="user"]'],botSelector:['div[data-message-author-role="assistant"]']},
    'claude.ai':{userSelector:['.font-user-message','[data-testid="user-message"]'],botSelector:['.font-claude-message']},
    'deepseek.com':{userSelector:['._9663006'],botSelector:['._4f9bf79']},
    'kimi.com':{userSelector:['.chat-content-item-user'],botSelector:['.chat-content-item-assistant']},
    'aistudio.google.com':{userSelector:['.chat-turn-container.user'],botSelector:['.chat-turn-container.model']}
  };

  const state = {
    isAnalyzerEnabled: true,
    userCount: 0,
    botCount: 0,
    recentMessage: { role: null, html: 'No messages detected yet.' }
  };

  const currentHostname = Object.keys(SITE_CONFIG).find(host => location.hostname.includes(host));
  const currentConfig = SITE_CONFIG[currentHostname];

  // --- 2. CORE LOGIC ---

  function initialize() {
    if (!currentConfig) return;

    chrome.storage.local.get({ isAnalyzerEnabled: true }, (result) => {
      state.isAnalyzerEnabled = result.isAnalyzerEnabled;
      injectStyles();
      document.body.classList.toggle('chat-analyzer-disabled', !state.isAnalyzerEnabled);
      const debouncedScan = debounce(scanAndMarkAll, 200);
      const observer = new MutationObserver(debouncedScan);
      observer.observe(document.body, { childList: true, subtree: true });
      debouncedScan();
    });
  }

  function scanAndMarkAll() {
    const allSelectors = [...(currentConfig.userSelector || []), ...(currentConfig.botSelector || [])].join(', ');
    if (!allSelectors) return;
    
    document.querySelectorAll(allSelectors).forEach(processNode);
    updateStateAndNotify();
  }

  function processNode(node) {
    if (node.dataset.chatAnalyzerProcessed) return;
    let role = null;
    if (matchesAnySelector(node, currentConfig.userSelector)) role = 'user';
    else if (matchesAnySelector(node, currentConfig.botSelector)) role = 'bot';

    if (role) {
      markMessage(node, role);
    }
  }

  function markMessage(element, role) {
    element.dataset.chatAnalyzerProcessed = 'true';
    element.classList.add(role === 'user' ? 'chat-analyzer-user' : 'chat-analyzer-bot');
    element.dataset.messageRole = role;
  }

  async function updateStateAndNotify() {
    const allMarked = document.querySelectorAll('[data-chat-analyzer-processed]');
    const visibleMessages = Array.from(allMarked).filter(el => el.offsetParent !== null);
    
    state.userCount = visibleMessages.filter(el => el.classList.contains('chat-analyzer-user')).length;
    state.botCount = visibleMessages.filter(el => el.classList.contains('chat-analyzer-bot')).length;

    const lastVisibleMessage = visibleMessages[visibleMessages.length - 1];

    if (lastVisibleMessage) {
        const role = lastVisibleMessage.dataset.messageRole;
        let displayHtml = lastVisibleMessage.innerHTML; // Always store raw HTML for preview

        // Process for TTS only if it's a bot message and should be spoken
        if (role === 'bot') {
            const processedText = await processTextForTTS(lastVisibleMessage, isInitialScan);
            if (processedText && !lastVisibleMessage.dataset.hasBeenSpoken) {
                lastVisibleMessage.dataset.hasBeenSpoken = 'true';
                sendToTTSGateway(processedText, role);
            }
        }

        state.recentMessage = {
            role: role,
            html: displayHtml
        };
        
    } else {
        state.recentMessage = { role: null, html: 'No messages detected yet.' };
    }
    
    try {
      chrome.runtime.sendMessage({ action: 'stateUpdate', data: state }, () => {
          // The presence of a callback prevents an Uncaught (in promise) error
          // when the extension context is invalidated. We can check chrome.runtime.lastError here
          // but in this case, we don't need to do anything.
          if (chrome.runtime.lastError) { /* Silently ignore */ }
      });
    } catch (e) { /* Safe to ignore */ }
    
    if (isInitialScan) {
      isInitialScan = false;
    }
  }

  async function processTextForTTS(element, isPageLoad) {
    const settings = await chrome.storage.local.get({
        isTtsEnabled: true,
        speakOnCompletion: true,
        speakOnLoad: false,
        formattingRules: {}
    });

    // --- DECISION LOGIC: Should we speak? ---
    if (!settings.isTtsEnabled) return null;
    if (isPageLoad && !settings.speakOnLoad) {
        return null;
    }
    if (!isPageLoad && !settings.speakOnCompletion) {
        return null;
    }
    
    // --- PROCESSING LOGIC: If we should speak, what do we say? ---
    const rulesConfig = settings.formattingRules;
    if (!rulesConfig || !rulesConfig.useFormatting) {
        return element.innerText.trim();
    }

    let processedText = element.innerText; // Start with innerText for text-based rules

    // Apply rules sequentially based on the JSON config
    rulesConfig.rules.forEach(rule => {
        if (!rule.enabled) return;

        switch (rule.id) {
            case 'removeMarkdown':
                processedText = processedText.replace(/\*\*([^\*]+?)\*\*/g, '$1'); // **bold**
                processedText = processedText.replace(/\*([^\*]+?)\*/g, '$1');   // *italics*
                processedText = processedText.replace(/`([^`]+?)`/g, '$1');     // `code`
                processedText = processedText.replace(/\[([^\]]+?)\]\([^\)]+?\)/g, '$1'); // [link](url)
                break;
            case 'removeCode':
                // This rule should ideally operate on HTML, but for innerText, we can try to remove common patterns
                // For more robust HTML removal, a DOM manipulation approach would be needed.
                // For now, we'll rely on innerText which strips most HTML.
                break;
            case 'removeJsCss':
                // Similar to removeCode, innerText already strips these.
                break;
            case 'removeSpecialChars':
                const specialCharsRule = rulesConfig.rules.find(r => r.id === 'specialCharsList');
                if (specialCharsRule && specialCharsRule.value) {
                    const escapedChars = specialCharsRule.value.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
                    const regex = new RegExp(`[${escapedChars}]`, 'g');
                    processedText = processedText.replace(regex, '');
                }
                break;
        }
    });

    return processedText.trim();
  }

async function sendToTTSGateway(processedText, messageRole) {
    if (!processedText) return;

    // FETCH ALL SETTINGS needed for the request
    const { selectedPiperModel, selectedSpeakerId, voiceSettings } = await chrome.storage.local.get([
        'selectedPiperModel', 
        'selectedSpeakerId',
        'voiceSettings'
    ]);

    if (!selectedPiperModel) {
        logEvent('TTS Request', 'No Piper model selected. Please configure it in the options page.', 'Error', 'sendToTTSGateway_noModel', {}, LOG_LEVELS.ERROR);
        return;
    }

    const payload = {
        text: processedText,
        model: selectedPiperModel
    };

    // Add speaker ID if it exists
    if (selectedSpeakerId !== null && selectedSpeakerId !== undefined) {
        payload.speaker_id = parseInt(selectedSpeakerId, 10);
    }

    // ADD NEW VOICE SETTINGS if they exist
    if (voiceSettings) {
        payload.length_scale = voiceSettings.lengthScale;
        payload.noise_scale = voiceSettings.noiseScale;
        payload.noise_w = voiceSettings.noiseW;
        payload.sentence_silence = voiceSettings.sentenceSilence;
    }
    
    logEvent('TTS Request', `Text: "${processedText.substring(0, 40)}...". Model: ${payload.model}. Speaker: ${payload.speaker_id ?? 'N/A'}`, 'Sent', `content_sendToTTSGateway_success_${messageRole}`, payload, LOG_LEVELS.INFO);
    
    chrome.runtime.sendMessage({ action: 'ttsRequest', payload }, (response) => {
        if (chrome.runtime.lastError) {
             logEvent('TTS Request', `Error messaging background: ${chrome.runtime.lastError.message}`, 'Error', 'content_ttsRequest_messagingError', LOG_LEVELS.ERROR, { errorMessage: chrome.runtime.lastError.message });
        } else if (response && response.success) {
            if (response.audioDataUrl) {
                const audio = new Audio(response.audioDataUrl);
                audio.play().catch(e => {
                    logEvent('TTS Playback', `Audio playback failed: ${e.message}`, 'Error', 'content_ttsPlayback_error', LOG_LEVELS.ERROR, { errorMessage: e.message });
                });
                audio.onended = () => {
                    // Clean up the Data URL if necessary, though for short-lived audio, it's often not critical.
                    // If using createObjectURL, revokeObjectURL would be here.
                };
            } else {
                // Audio is being played by the gateway, no action needed in content script.
                logEvent('TTS Playback', 'Audio playback handled by gateway.', 'Info', 'content_ttsPlayback_gateway', LOG_LEVELS.INFO);
            }
        } else if (response && !response.success) {
            logEvent('TTS Request', `Gateway failed: ${response.error}`, 'Error', 'content_ttsRequest_gatewayFailed', LOG_LEVELS.ERROR, { errorMessage: response.error });
        }
    });
}

  // --- 3. COMMUNICATION & HELPERS ---

  function insertTextAtCursor(text) {
    const activeElement = document.activeElement;
    if (!activeElement) return;

    // Check if the active element is an input field or a textarea
    if (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA') {
      const start = activeElement.selectionStart;
      const end = activeElement.selectionEnd;
      const value = activeElement.value;

      activeElement.value = value.substring(0, start) + text + value.substring(end);
      activeElement.selectionStart = activeElement.selectionEnd = start + text.length;

      // Dispatch input event to trigger any frameworks listening for changes
      activeElement.dispatchEvent(new Event('input', { bubbles: true }));
    } else if (activeElement.isContentEditable) {
      // For contenteditable elements (like some chat inputs)
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        range.deleteContents();
        range.insertNode(document.createTextNode(text));
        selection.collapseToEnd();
      }
    }
  }

  async function startAsrPolling() {
    if (asrPollingInterval) {
      clearInterval(asrPollingInterval);
    }
    asrPollingInterval = setInterval(async () => {
      try {
        const response = await fetch(`${GATEWAY_URL}/api/asr/results`);
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        const results = await response.json();
        if (results && results.length > 0) {
          results.forEach(text => {
            insertTextAtCursor(text + " "); // Add a space after insertion
            logEvent('ASR Input', `Inserted: "${text}"`, 'Success', 'asr_text_inserted', {}, LOG_LEVELS.INFO);
          });
        }
      } catch (error) {
        logEvent('ASR Polling', `Error fetching ASR results: ${error.message}`, 'Error', 'asr_polling_error', { errorMessage: error.message }, LOG_LEVELS.ERROR);
      }
    }, ASR_POLLING_INTERVAL_MS);
    logEvent('ASR Polling', 'Started ASR polling.', 'Info', 'asr_polling_started', {}, LOG_LEVELS.INFO);
  }

  function stopAsrPolling() {
    if (asrPollingInterval) {
      clearInterval(asrPollingInterval);
      asrPollingInterval = null;
      logEvent('ASR Polling', 'Stopped ASR polling.', 'Info', 'asr_polling_stopped', {}, LOG_LEVELS.INFO);
    }
  }
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'ping') {
      sendResponse({ status: 'ready' });
      return true; // Indicates an asynchronous response.
    }
    if (message.action === 'getData') {
      sendResponse(state);
      return true; // Indicates an asynchronous response.
    }
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
    } else if (message.action === 'startAsrPolling') {
      startAsrPolling();
    } else if (message.action === 'stopAsrPolling') {
      stopAsrPolling();
    }
  });
  
  

  function insertTextAtCursor(text) {
    const activeElement = document.activeElement;
    if (!activeElement) return;

    // Check if the active element is an input field or a textarea
    if (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA') {
      const start = activeElement.selectionStart;
      const end = activeElement.selectionEnd;
      const value = activeElement.value;

      activeElement.value = value.substring(0, start) + text + value.substring(end);
      activeElement.selectionStart = activeElement.selectionEnd = start + text.length;

      // Dispatch input event to trigger any frameworks listening for changes
      activeElement.dispatchEvent(new Event('input', { bubbles: true }));
    } else if (activeElement.isContentEditable) {
      // For contenteditable elements (like some chat inputs)
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        range.deleteContents();
        range.insertNode(document.createTextNode(text));
        selection.collapseToEnd();
      }
    }
  }

  async function startAsrPolling() {
    if (asrPollingInterval) {
      clearInterval(asrPollingInterval);
    }
    asrPollingInterval = setInterval(async () => {
      try {
        const response = await fetch(`${GATEWAY_URL}/api/asr/results`);
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        const results = await response.json();
        if (results && results.length > 0) {
          results.forEach(text => {
            insertTextAtCursor(text + " "); // Add a space after insertion
            logEvent('ASR Input', `Inserted: "${text}"`, 'Success', 'asr_text_inserted', {}, LOG_LEVELS.INFO);
          });
        }
      } catch (error) {
        logEvent('ASR Polling', `Error fetching ASR results: ${error.message}`, 'Error', 'asr_polling_error', { errorMessage: error.message }, LOG_LEVELS.ERROR);
      }
    }, ASR_POLLING_INTERVAL_MS);
    logEvent('ASR Polling', 'Started ASR polling.', 'Info', 'asr_polling_started', {}, LOG_LEVELS.INFO);
  }

  function stopAsrPolling() {
    if (asrPollingInterval) {
      clearInterval(asrPollingInterval);
      asrPollingInterval = null;
      logEvent('ASR Polling', 'Stopped ASR polling.', 'Info', 'asr_polling_stopped', {}, LOG_LEVELS.INFO);
    }
  }

  function insertTextAtCursor(text) {
    const activeElement = document.activeElement;
    if (!activeElement) return;

    // Check if the active element is an input field or a textarea
    if (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA') {
      const start = activeElement.selectionStart;
      const end = activeElement.selectionEnd;
      const value = activeElement.value;

      activeElement.value = value.substring(0, start) + text + value.substring(end);
      activeElement.selectionStart = activeElement.selectionEnd = start + text.length;

      // Dispatch input event to trigger any frameworks listening for changes
      activeElement.dispatchEvent(new Event('input', { bubbles: true }));
    } else if (activeElement.isContentEditable) {
      // For contenteditable elements (like some chat inputs)
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        range.deleteContents();
        range.insertNode(document.createTextNode(text));
        selection.collapseToEnd();
      }
    }
  }

  function logEvent(event, details, status, triggerId = 'N/A', fullData = {}, level = LOG_LEVELS.INFO) {
     chrome.runtime.sendMessage({
        action: 'logEvent',
        payload: { source: 'content.js', event, details, status, triggerId, fullData, level }
    });
  }
  
  function matchesAnySelector(node, selectors) {
    return selectors.some(selector => node.matches(selector));
  }
  
  function debounce(func, delay) {
    let timeout;
    return (...args) => {
      clearTimeout(timeout);
      timeout = setTimeout(() => func.apply(this, args), delay);
    };
  }

  function injectStyles() {
    const styleId = 'chat-analyzer-styles';
    if (document.getElementById(styleId)) return;
    const css = `
      .chat-analyzer-user, .chat-analyzer-bot { 
        transition: background-color 0.3s ease, border-color 0.3s ease; 
        border-radius: 6px;
      }
      .chat-analyzer-user { border-left: 3px solid rgba(59, 130, 246, 0.7) !important; background-color: rgba(59, 130, 246, 0.07) !important; }
      .chat-analyzer-bot { border-left: 3px solid rgba(239, 68, 68, 0.7) !important; background-color: rgba(239, 68, 68, 0.07) !important; }
      
      body.chat-analyzer-disabled .chat-analyzer-user,
      body.chat-analyzer-disabled .chat-analyzer-bot {
        border-left-color: transparent !important;
        background-color: transparent !important;
      }
    `;
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = css;
    document.head.appendChild(style);
  }

  try {
    initialize();
    console.log("Content script message listener registered.");
  } catch (e) {
    console.error("Error initializing content script:", e);
  }
})();