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
  // ASR polling is now handled by the background script via WebSockets.

  const SITE_CONFIG = {
    // IMPORTANT: Keep these selectors updated as website structures may change.
    // Use browser developer tools to inspect elements and update selectors if chat analysis stops working.
    'chatgpt.com': {
      userSelector: ['div[data-message-author-role="user"]'],
      botSelector: ['div[data-message-author-role="assistant"]'],
      ttsExcludeSelectors: ['pre', 'code', 'button', 'svg'],
      thinkingIndicatorSelector: '.result-streaming',
      thoughtsSelector: null,
      errorSelector: '[data-testid="conversation-turn-error-text"]',
    },
    'claude.ai': {
      userSelector: ['.font-user-message', '[data-testid="user-message"]'],
      botSelector: ['.font-claude-message'],
      ttsExcludeSelectors: ['pre', 'code', 'button', 'svg'],
      thinkingIndicatorSelector: '.dot-flashing',
      thoughtsSelector: null,
      errorSelector: null, // Claude shows errors in the same message block
    },
    'deepseek.com': {
      userSelector: ['._9663006'],
      botSelector: ['._4f9bf79'],
      ttsExcludeSelectors: ['pre', 'code', 'button', 'svg'],
      thinkingIndicatorSelector: null,
      thoughtsSelector: null,
      errorSelector: null,
    },
    'kimi.com': {
      userSelector: ['.chat-content-item-user'],
      botSelector: ['.chat-content-item-assistant'],
      ttsExcludeSelectors: ['pre', 'code', 'button', 'svg'],
      thinkingIndicatorSelector: null,
      thoughtsSelector: null,
      errorSelector: '.chat-error-container',
    },
    'aistudio.google.com': {
      userSelector: ['.chat-turn-container.user'],
      botSelector: ['.chat-turn-container.model'],
      ttsExcludeSelectors: ['pre', 'code', 'button', 'svg', 'mat-icon'],
      thinkingIndicatorSelector: '.loading-animation-container',
      thoughtsSelector: null,
      errorSelector: '.error-container',
    }
  };

  const state = {
    isAnalyzerEnabled: true,
    userCount: 0,
    botCount: 0,
    recentMessage: { role: null, html: 'No messages detected yet.' }
  };

  // State management for tracking individual bot messages for TTS
  const ttsMessageTracker = new Map();

  const currentHostname = Object.keys(SITE_CONFIG).find(host => location.hostname.includes(host));
  const currentConfig = SITE_CONFIG[currentHostname];

  // --- 2. CORE LOGIC (Refactored for Streaming) ---

  function initialize() {
    if (!currentConfig) return;

    // This debounced function will update the UI after a short delay, allowing
    // for streaming messages to populate before the "last message" is captured.
    const debouncedUpdate = debounce(updateCountsAndNotify, 250);

    chrome.storage.local.get({ isAnalyzerEnabled: true }, (result) => {
      state.isAnalyzerEnabled = result.isAnalyzerEnabled;
      injectStyles();
      document.body.classList.toggle('chat-analyzer-disabled', !state.isAnalyzerEnabled);

      const observer = new MutationObserver((mutations) => handleMutations(mutations, debouncedUpdate));
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
      });

      // Initial scan for any messages already on the page
      const initialUserMessages = document.querySelectorAll(currentConfig.userSelector.join(','));
      initialUserMessages.forEach(node => markMessage(node, 'user'));

      const initialBotMessages = document.querySelectorAll(currentConfig.botSelector.join(','));
      initialBotMessages.forEach(node => processBotMessage(node, true));

      updateCountsAndNotify(); // Update immediately on load
    });
  }

  function handleMutations(mutations, debouncedUpdate) {
    if (!state.isAnalyzerEnabled) return;

    let needsStateUpdate = false;

    for (const mutation of mutations) {
      if (mutation.type === 'childList') {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;

          if (currentConfig.thinkingIndicatorSelector && matchesAnySelector(node, [currentConfig.thinkingIndicatorSelector])) {
            chrome.runtime.sendMessage({ action: 'play_audio_cue', sound: 'thinking' });
          }
          if (currentConfig.errorSelector && matchesAnySelector(node, [currentConfig.errorSelector])) {
            chrome.runtime.sendMessage({ action: 'play_audio_cue', sound: 'error' });
            needsStateUpdate = true;
          }

          if (matchesAnySelector(node, currentConfig.userSelector)) {
            markMessage(node, 'user');
            needsStateUpdate = true;
          }
          if (matchesAnySelector(node, currentConfig.botSelector)) {
            processBotMessage(node, false);
            needsStateUpdate = true;
          }
        }
      }

      if (mutation.type === 'characterData') {
        const parentBotMessage = mutation.target.parentElement?.closest(currentConfig.botSelector.join(','));
        if (parentBotMessage) {
          processBotMessage(parentBotMessage, false);
          needsStateUpdate = true;
        }
      }
    }

    if (needsStateUpdate) {
      debouncedUpdate();
    }
  }

  function getSanitizedText(node) {
    const clone = node.cloneNode(true);
    if (currentConfig.ttsExcludeSelectors && currentConfig.ttsExcludeSelectors.length > 0) {
      const excludeSelector = currentConfig.ttsExcludeSelectors.join(',');
      clone.querySelectorAll(excludeSelector).forEach(el => el.remove());
    }
    return clone.innerText;
  }

  function processBotMessage(node, isPageLoad) {
    markMessage(node, 'bot');

    // --- Real-time TTS Batching Logic (Corrected) ---
    if (!ttsMessageTracker.has(node)) {
      ttsMessageTracker.set(node, {
        processedLength: 0, // Tracks how much of the text has been processed.
        buffer: ''          // Stores incomplete sentences.
      });
    }

    const tracker = ttsMessageTracker.get(node);
    const currentText = getSanitizedText(node);

    // Only process if there's new text we haven't seen.
    if (currentText.length > tracker.processedLength) {
      const newTextChunk = currentText.substring(tracker.processedLength);
      tracker.processedLength = currentText.length; // Update our pointer immediately.
      tracker.buffer += newTextChunk;

      const sentenceEndings = /(?<=[.?!])\s*/;
      let sentences = tracker.buffer.split(sentenceEndings);

      if (sentences.length > 1) {
        const completeSentences = sentences.slice(0, -1).join('');
        tracker.buffer = sentences[sentences.length - 1]; // Keep the remainder in the buffer.

        if (completeSentences) {
          sendToTTSGateway(completeSentences.trim());
        }
      }
    }
  }

  function markMessage(element, role) {
    if (element.dataset.chatAnalyzerProcessed) return;
    element.dataset.chatAnalyzerProcessed = 'true';
    element.classList.add(role === 'user' ? 'chat-analyzer-user' : 'chat-analyzer-bot');
    element.dataset.messageRole = role;
  }

  function updateCountsAndNotify() {
    const allMarked = document.querySelectorAll('[data-chat-analyzer-processed]');
    const visibleMessages = Array.from(allMarked).filter(el => el.offsetParent !== null);
    
    state.userCount = visibleMessages.filter(el => el.classList.contains('chat-analyzer-user')).length;
    state.botCount = visibleMessages.filter(el => el.classList.contains('chat-analyzer-bot')).length;

    const lastVisibleMessage = visibleMessages[visibleMessages.length - 1];

    if (lastVisibleMessage) {
      state.recentMessage = {
        role: lastVisibleMessage.dataset.messageRole,
        html: lastVisibleMessage.innerHTML
      };
    } else {
      state.recentMessage = { role: null, html: 'No messages detected yet.' };
    }
    
    try {
      chrome.runtime.sendMessage({ action: 'stateUpdate', data: state });
    } catch (e) { /* Safe to ignore */ }

    if (isInitialScan) {
      isInitialScan = false;
    }
  }

async function sendToTTSGateway(processedText) {
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
    
    logEvent('TTS Request', `Text: "${processedText.substring(0, 40)}...". Model: ${payload.model}. Speaker: ${payload.speaker_id ?? 'N/A'}`, 'Sent', 'content_sendToTTSGateway_success', payload, LOG_LEVELS.INFO);
    
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

  // ASR control is now managed by the background script.
  // The content script just receives the final text.
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.action) {
      case 'ping':
        sendResponse({ status: 'ready' });
        break;
      case 'getData':
        sendResponse(state);
        break;
      case 'asr_result_push':
        if (message.text) {
          insertTextAtCursor(message.text + " "); // Add a space after insertion
          logEvent('ASR Input', `Inserted via WebSocket: "${message.text}"`, 'Success', 'asr_text_inserted_ws', {}, LOG_LEVELS.INFO);
        }
        break;
      case 'request_chat_history':
        loadFullHistoryAndDownload(message.format)
          .then(() => sendResponse({ success: true }))
          .catch(err => sendResponse({ success: false, error: err.message }));
        return true; // Indicates an asynchronous response.
    }
    return true; // Indicates that the response may be sent asynchronously.
  });

  async function loadFullHistoryAndDownload(format) {
    logEvent('History Download', `Starting history download (Format: ${format}).`, 'Info', 'history_download_start');

    // This is a placeholder for the scroll container selector.
    // A more robust solution would add this to SITE_CONFIG.
    const scrollContainer = document.querySelector('main');

    if (!scrollContainer) {
      throw new Error("Could not find a scrollable chat container.");
    }

    let lastScrollHeight = 0;
    let retries = 3; // Number of times to try scrolling up without change before stopping.

    while (true) {
      const currentScrollHeight = scrollContainer.scrollHeight;
      scrollContainer.scrollTop = 0; // Scroll to the top

      // Wait for new content to potentially load
      await new Promise(resolve => setTimeout(resolve, 1000));

      const newScrollHeight = scrollContainer.scrollHeight;

      if (newScrollHeight === currentScrollHeight) {
        retries--;
        if (retries <= 0) {
          logEvent('History Download', 'Reached the top of the conversation.', 'Info', 'history_download_top');
          break; // Exit loop if scroll height hasn't changed after retries
        }
      } else {
        retries = 3; // Reset retries if new content was loaded
      }
      lastScrollHeight = newScrollHeight;
    }

    // Now collect and format the history
    await collectAndFormatHistory(format);
  }

  async function collectAndFormatHistory(format) {
    const allSelectors = [...currentConfig.userSelector, ...currentConfig.botSelector].join(',');
    const allMessages = Array.from(document.querySelectorAll(allSelectors));

    let formattedText = '';
    const title = document.title || 'Chat History';

    if (format === 'md') {
      formattedText = `# ${title}\n\n`;
      formattedText += allMessages.map(node => {
        const role = matchesAnySelector(node, currentConfig.userSelector) ? 'User' : 'Bot';
        const content = getSanitizedText(node); // Reuse sanitation logic
        return `### ${role}\n\n${content}\n\n---\n\n`;
      }).join('');
    } else { // txt format
      formattedText = `${title}\n\n`;
      formattedText += allMessages.map(node => {
        const role = matchesAnySelector(node, currentConfig.userSelector) ? 'User' : 'Bot';
        const content = getSanitizedText(node);
        return `[${role.toUpperCase()}]\n${content}\n\n====================\n\n`;
      }).join('');
    }

    // Send the result to the background script for download
    chrome.runtime.sendMessage({
      action: 'download_history',
      payload: {
        content: formattedText,
        format: format,
        filename: title.replace(/[^a-z0-9_]/gi, '_').toLowerCase() // Generate a safe filename
      }
    });
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