// options.js v3.3 (Voice Characteristics, Preview, and new UI)
document.addEventListener('DOMContentLoaded', () => {
    // --- Element Selectors ---
    const voskSelect = document.getElementById('vosk-model-select');
    const piperSelect = document.getElementById('piper-model-select');
    const piperSpeakerGroup = document.getElementById('piper-speaker-group');
    const piperSpeakerSelect = document.getElementById('piper-speaker-select');

    const lengthScaleInput = document.getElementById('length-scale-input');
    const lengthScaleRange = document.getElementById('length-scale-range');
    const noiseScaleInput = document.getElementById('noise-scale-input');
    const noiseScaleRange = document.getElementById('noise-scale-range');
    const noiseWInput = document.getElementById('noise-w-input');
    const noiseWRange = document.getElementById('noise-w-range');
    const sentenceSilenceInput = document.getElementById('sentence-silence-input');
    const sentenceSilenceRange = document.getElementById('sentence-silence-range');
    const previewVoiceButton = document.getElementById('preview-voice-button');

    const speakOnCompletionToggle = document.getElementById('speak-on-completion-toggle');
    const speakOnLoadToggle = document.getElementById('speak-on-load-toggle');
    const playInBrowserToggle = document.getElementById('play-in-browser-toggle');
    
    const useFormattingToggle = document.getElementById('use-formatting-toggle');
    const processingRulesGroup = document.getElementById('processing-rules-group');
    const rulesContainer = document.getElementById('rules-container');

    const editJsonButton = document.getElementById('edit-json-button');
    const jsonModal = document.getElementById('json-modal');
    const jsonEditor = document.getElementById('json-editor');
    const saveJsonButton = document.getElementById('save-json-button');
    const cancelJsonButton = document.getElementById('cancel-json-button');
    const applyPreviewButton = document.getElementById('apply-preview-button');
    const previewOriginal = document.getElementById('preview-original');
    const previewFormatted = document.getElementById('preview-formatted');

    const saveButton = document.getElementById('save-button');
    const statusEl = document.getElementById('status');

    const popupLink = document.getElementById('popup-link');
    const logsLink = document.getElementById('logs-link');
    
    const GATEWAY_URL = 'http://127.0.0.1:5000';

    // --- LOGGING LEVELS (Mirroring background.js) ---
    const LOG_LEVELS = {
      DEBUG: 0,
      INFO: 1,
      WARN: 2,
      ERROR: 3,
      CRITICAL: 4
    };

    // --- State ---
    let formattingRules = {};
    const sampleBotMessage = "This is a **sample** bot message with some `code` and a [link](https://example.com). It also has some special characters like * and # and /.";

    /**
     * Links a number input and a range input so their values are synchronized.
     * @param {HTMLInputElement} numberInput - The number input element.
     * @param {HTMLInputElement} rangeInput - The range input element.
     */
    function linkInputs(numberInput, rangeInput) {
        numberInput.addEventListener('input', () => {
            rangeInput.value = numberInput.value;
        });
        rangeInput.addEventListener('input', () => {
            numberInput.value = rangeInput.value;
        });
    }

    linkInputs(lengthScaleInput, lengthScaleRange);
    linkInputs(noiseScaleInput, noiseScaleRange);
    linkInputs(noiseWInput, noiseWRange);
    linkInputs(sentenceSilenceInput, sentenceSilenceRange);

    // --- Default Rules Structure ---
    /**
     * Returns the default formatting rules structure.
     * @returns {object} The default formatting rules.
     */
    const getDefaultFormattingRules = () => ({
        useFormatting: true,
        rules: [
            { id: 'removeMarkdown', enabled: true, description: 'Remove basic markdown (e.g., *, **, ` `)' },
            { id: 'removeCode', enabled: true, description: 'Remove code blocks (e.g., <pre>, <code>)' },
            { id: 'removeJsCss', enabled: true, description: 'Remove JS/CSS elements (e.g., <script>, <style>)' },
            { id: 'removeSpecialChars', enabled: false, description: 'Remove special characters defined below:' },
            { id: 'specialCharsList', value: '*#[]/\\^', description: 'List of special characters to remove' }
        ]
    });

    // --- UI Logic ---
    /**
     * Updates the disabled state of the processing rules group based on the useFormattingToggle.
     */
    function updateProcessingGroupState() {
        processingRulesGroup.disabled = !useFormattingToggle.checked;
    }

    /**
     * Renders the checkboxes for formatting rules.
     * @param {Array<Object>} rules - An array of rule objects.
     */
    function renderRuleCheckboxes(rules) {
        rulesContainer.innerHTML = '';
        rules.forEach(rule => {
            const item = document.createElement('div');
            item.className = 'checkbox-item';

            if (rule.id === 'specialCharsList') {
                item.innerHTML = `
                    <label for="rule-${rule.id}" style="flex-grow: 1;">${rule.description}</label>
                    <input type="text" id="rule-${rule.id}" value="${rule.value}" style="width: 50%;">
                `;
            } else {
                item.innerHTML = `
                    <input type="checkbox" id="rule-${rule.id}" ${rule.enabled ? 'checked' : ''}>
                    <label for="rule-${rule.id}">${rule.description}</label>
                `;
            }
            rulesContainer.appendChild(item);
        });
    }

    // --- Data & API Logic ---
    /**
     * Populates a select element with models fetched from the gateway.
     * @param {HTMLSelectElement} selectElement - The select element to populate.
     * @param {string} endpoint - The API endpoint to fetch models from.
     */
    async function populateModels(selectElement, endpoint) {
        selectElement.innerHTML = '<option value="">-- Loading models... --</option>';
        selectElement.disabled = true;
        try {
            const response = await fetch(`${GATEWAY_URL}${endpoint}`);
            if (!response.ok) throw new Error(`Gateway not responding at ${endpoint}`);
            const models = await response.json();
            
            selectElement.innerHTML = '<option value="">-- Please select a model --</option>';
            if (models.length === 0) {
                selectElement.innerHTML = '<option value="">-- No models found --</option>';
                return;
            }
            
            models.forEach(model => {
                const option = document.createElement('option');
                option.value = model.path;
                option.textContent = model.name;
                if (model.speakers && model.speakers.length > 1) {
                    option.dataset.speakers = JSON.stringify(model.speakers);
                }
                selectElement.appendChild(option);
            });
        } catch (error) {
            showStatus(`Error fetching models: ${error.message}`, 'error', 5000, LOG_LEVELS.ERROR);
            selectElement.innerHTML = '<option value="">-- Error loading models --</option>';
        } finally {
            selectElement.disabled = false;
        }
    }

    /**
     * Updates the Piper speaker UI based on the selected Piper model.
     */
    function updatePiperSpeakerUI() {
        const selectedOption = piperSelect.options[piperSelect.selectedIndex];
        const speakersData = selectedOption?.dataset.speakers;

        if (!speakersData) {
            piperSpeakerGroup.hidden = true;
            piperSpeakerSelect.innerHTML = '';
            return;
        }

        const speakers = JSON.parse(speakersData);
        piperSpeakerSelect.innerHTML = '';
        speakers.sort((a, b) => a.id - b.id).forEach(speaker => {
            const option = document.createElement('option');
            option.value = speaker.id;
            option.textContent = `${speaker.name} (ID: ${speaker.id})`;
            piperSpeakerSelect.appendChild(option);
        });
        
        piperSpeakerGroup.hidden = false;
        
        chrome.storage.local.get({ selectedSpeakerId: '0' }, (items) => {
            piperSpeakerSelect.value = items.selectedSpeakerId;
        });
    }

    /**
     * Saves the current options to Chrome local storage.
     */
    function saveOptions() {
        if (!voskSelect.value || !piperSelect.value) {
            showStatus('Error: Please select a model for both ASR and TTS.', 'error', 5000, LOG_LEVELS.ERROR);
            return;
        }

        // Validate numeric inputs
        const validateNumericInput = (inputElement, min, max, fieldName) => {
            const value = parseFloat(inputElement.value);
            if (isNaN(value) || value < min || value > max) {
                showStatus(`Error: ${fieldName} must be between ${min} and ${max}.`, 'error', 5000, LOG_LEVELS.ERROR);
                inputElement.focus();
                return false;
            }
            return true;
        };

        if (!validateNumericInput(lengthScaleInput, 0.1, 2.0, 'Length Scale')) return;
        if (!validateNumericInput(noiseScaleInput, 0, 1.0, 'Noise Scale')) return;
        if (!validateNumericInput(noiseWInput, 0, 1.0, 'Noise W')) return;
        if (!validateNumericInput(sentenceSilenceInput, 0.1, 2.0, 'Sentence Silence')) return;

        formattingRules.useFormatting = useFormattingToggle.checked;
        formattingRules.rules.forEach(rule => {
            const inputEl = document.getElementById(`rule-${rule.id}`);
            if (rule.id === 'specialCharsList') {
                rule.value = inputEl.value;
            } else {
                rule.enabled = inputEl.checked;
            }
        });

        chrome.storage.local.set({
            selectedVoskModel: voskSelect.value,
            selectedPiperModel: piperSelect.value,
            selectedSpeakerId: piperSpeakerGroup.hidden ? null : piperSpeakerSelect.value,
            
            voiceSettings: {
                lengthScale: parseFloat(lengthScaleInput.value),
                noiseScale: parseFloat(noiseScaleInput.value),
                noiseW: parseFloat(noiseWInput.value),
                sentenceSilence: parseFloat(sentenceSilenceInput.value)
            },

            speakOnCompletion: speakOnCompletionToggle.checked,
            speakOnLoad: speakOnLoadToggle.checked,
            playInBrowser: playInBrowserToggle.checked,
            formattingRules: formattingRules,
        }, () => {
            showStatus('Options saved successfully!', 'success', 3000, LOG_LEVELS.INFO);
        });
    }

    /**
     * Restores options from Chrome local storage and updates the UI.
     */
    function restoreOptions() {
        chrome.storage.local.get({
            selectedVoskModel: '',
            selectedPiperModel: '',
            selectedSpeakerId: '0',
            voiceSettings: {
                lengthScale: 1.0,
                noiseScale: 0.667,
                noiseW: 0.8,
                sentenceSilence: 0.2
            },
            speakOnCompletion: true,
            speakOnLoad: false,
            playInBrowser: false,
            formattingRules: getDefaultFormattingRules()
        }, (items) => {
            // Restore Models
            if (items.selectedVoskModel) voskSelect.value = items.selectedVoskModel;
            if (items.selectedPiperModel) piperSelect.value = items.selectedPiperModel;
            updatePiperSpeakerUI(); 
            if (items.selectedSpeakerId) piperSpeakerSelect.value = items.selectedSpeakerId;

            // Restore voice characteristics
            const vs = items.voiceSettings;
            lengthScaleInput.value = vs.lengthScale;
            noiseScaleInput.value = vs.noiseScale;
            noiseWInput.value = vs.noiseW;
            sentenceSilenceInput.value = vs.sentenceSilence;

            // Restore range inputs as well
            lengthScaleRange.value = vs.lengthScale;
            noiseScaleRange.value = vs.noiseScale;
            noiseWRange.value = vs.noiseW;
            sentenceSilenceRange.value = vs.sentenceSilence;

            // Restore Playback
            speakOnCompletionToggle.checked = items.speakOnCompletion;
            speakOnLoadToggle.checked = items.speakOnLoad;
            playInBrowserToggle.checked = items.playInBrowser;

            // Restore Formatting
            formattingRules = items.formattingRules;
            useFormattingToggle.checked = formattingRules.useFormatting;
            renderRuleCheckboxes(formattingRules.rules);
            updateProcessingGroupState();
        });
    }

    /**
     * Displays a status message to the user.
     * @param {string} message - The message to display.
     * @param {string} color - The color of the message (e.g., '#9ece6a' for success, '#f7768e' for error).
     */
    let statusMessageTimeoutId; // Use a specific timeout ID for status messages
    function showStatus(message, type = 'info', duration = 3000, level = LOG_LEVELS.INFO) {
        statusEl.textContent = message;
        // Map type to color for UI feedback
        let color;
        switch(type) {
            case 'success': color = 'var(--color-accent-green)'; break;
            case 'error': color = 'var(--color-accent-red)'; break;
            case 'warn': color = 'orange'; break; // Add a warning color
            default: color = 'var(--color-accent-blue-light)'; // Info color
        }
        statusEl.style.color = color;
        statusEl.classList.add('show'); // Add 'show' class for visibility

        if (statusMessageTimeoutId) {
            clearTimeout(statusMessageTimeoutId);
        }
        statusMessageTimeoutId = setTimeout(() => {
            statusEl.classList.remove('show');
            // Clear text after transition for accessibility
            setTimeout(() => {
                statusEl.textContent = '';
                statusEl.style.color = '';
            }, 300); // Match CSS transition duration
        }, duration);

        // Send log to background script for persistent storage
        chrome.runtime.sendMessage({
            action: 'logEvent',
            payload: { source: 'options.js', event: 'UI Status', details: message, status: type, trigger: 'showStatus', level: level }
        });
    }

    /**
     * Applies formatting rules to a given text.
     * This logic is similar to content.js's processTextForTTS.
     * @param {string} text - The original text.
     * @param {object} rulesConfig - The formatting rules configuration.
     * @returns {string} The formatted text.
     */
    function applyFormattingToText(text, rulesConfig) {
        let processedText = text;

        if (!rulesConfig.useFormatting) {
            return processedText;
        }

        rulesConfig.rules.forEach(rule => {
            if (rule.enabled) {
                switch (rule.id) {
                    case 'removeMarkdown':
                        // Remove bold, italics, code, links (simple markdown)
                        processedText = processedText.replace(/\*\*([^\*]+?)\*\*/g, '$1'); // **bold**
                        processedText = processedText.replace(/\*([^\*]+?)\*/g, '$1');   // *italics*
                        processedText = processedText.replace(/`([^`]+?)`/g, '$1');     // `code`
                        processedText = processedText.replace(/\[([^\]]+?)\]\([^\)]+?\)/g, '$1'); // [link](url)
                        break;
                    case 'removeCode':
                        // Remove <pre> and <code> tags and their content
                        processedText = processedText.replace(/<pre[^>]*>.*?<\/pre>/gs, '');
                        processedText = processedText.replace(/<code[^>]*>.*?<\/code>/gs, '');
                        break;
                    case 'removeJsCss':
                        // Remove <script> and <style> tags and their content
                        processedText = processedText.replace(/<script[^>]*>.*?<\/script>/gs, '');
                        processedText = processedText.replace(/<style[^>]*>.*?<\/style>/gs, '');
                        break;
                    case 'removeSpecialChars':
                        const specialCharsRule = rulesConfig.rules.find(r => r.id === 'specialCharsList');
                        if (specialCharsRule && specialCharsRule.value) {
                            const charsToRemove = specialCharsRule.value.split('').map(char => `\\${char}`).join('');
                            const regex = new RegExp(`[${charsToRemove}]`, 'g');
                            processedText = processedText.replace(regex, '');
                        }
                        break;
                }
            }
        });
        return processedText.trim();
    }

    /**
     * Handles the preview voice button click event.
     * Sends a TTS request to the gateway with a preview message and current settings.
     */
    async function handlePreviewVoice() {
        const model = piperSelect.value;
        if (!model) {
            showStatus('Please select a Piper voice model first.', 'error', 5000, LOG_LEVELS.WARN);
            return;
        }

        previewVoiceButton.disabled = true;
        previewVoiceButton.textContent = 'Playing...';

        const payload = {
            text: 'This is a preview of the selected voice and its settings.',
            model: model,
            speaker_id: piperSpeakerGroup.hidden ? null : parseInt(piperSpeakerSelect.value, 10),
            length_scale: parseFloat(lengthScaleInput.value),
            noise_scale: parseFloat(noiseScaleInput.value),
            noise_w: parseFloat(noiseWInput.value),
            sentence_silence: parseFloat(sentenceSilenceInput.value)
        };

        chrome.runtime.sendMessage({ action: 'ttsRequest', payload }, (response) => {
            if (chrome.runtime.lastError || (response && !response.success)) {
                showStatus(`Failed to play preview. Is the gateway running? Error: ${response?.error || chrome.runtime.lastError?.message}`, 'error', 5000, LOG_LEVELS.ERROR);
            }
            previewVoiceButton.disabled = false;
            previewVoiceButton.textContent = 'Preview Voice';
        });
    }

    // --- JSON Modal Logic ---
    let jsonEditorDebounceTimeout;

    function updatePreview() {
        clearTimeout(jsonEditorDebounceTimeout);
        jsonEditorDebounceTimeout = setTimeout(() => {
            try {
                const currentJson = JSON.parse(jsonEditor.value);
                // Temporarily apply these rules for preview
                const tempFormattedText = applyFormattingToText(sampleBotMessage, currentJson);
                previewFormatted.textContent = tempFormattedText;
                previewFormatted.style.color = 'var(--text-primary)';
            } catch (e) {
                previewFormatted.textContent = `Invalid JSON: ${e.message}`;
                previewFormatted.style.color = 'var(--accent-danger)';
            }
        }, 300); // Debounce for 300ms
    }

    editJsonButton.addEventListener('click', () => {
        jsonEditor.value = JSON.stringify(formattingRules, null, 2);
        previewOriginal.textContent = sampleBotMessage;
        updatePreview(); // Initial preview update
        jsonModal.classList.remove('hidden');
    });

    cancelJsonButton.addEventListener('click', () => {
        jsonModal.classList.add('hidden');
    });

    saveJsonButton.addEventListener('click', () => {
        try {
            const newRules = JSON.parse(jsonEditor.value);
            if (typeof newRules.useFormatting !== 'boolean' || !Array.isArray(newRules.rules)) {
                throw new Error("Invalid JSON structure: 'useFormatting' boolean or 'rules' array missing.");
            }
            // Basic validation for rules array content
            newRules.rules.forEach(rule => {
                if (!rule.id || typeof rule.enabled === 'undefined' && rule.id !== 'specialCharsList') {
                    throw new Error(`Invalid rule object found: ${JSON.stringify(rule)}`);
                }
            });

            formattingRules = newRules;
            useFormattingToggle.checked = formattingRules.useFormatting;
            renderRuleCheckboxes(formattingRules.rules);
            updateProcessingGroupState();
            showStatus('JSON rules updated. Click "Save All Settings" to persist.', 'info', 5000, LOG_LEVELS.INFO);
            jsonModal.classList.add('hidden');
        } catch (e) {
            showStatus(`Error parsing or validating JSON: ${e.message}`, 'error', 5000, LOG_LEVELS.ERROR, { errorMessage: e.message, jsonContent: jsonEditor.value });
        }
    });

    applyPreviewButton.addEventListener('click', updatePreview);
    jsonEditor.addEventListener('input', updatePreview);

    // --- Initialization & Event Listeners ---
    async function initialize() {
        await Promise.all([
            populateModels(voskSelect, '/api/models/vosk'),
            populateModels(piperSelect, '/api/models/piper')
        ]);
        restoreOptions();

        // Event listeners for navigation links
        popupLink.addEventListener('click', (e) => {
            e.preventDefault();
            chrome.runtime.sendMessage({ action: 'openPopupPage' });
        });
        logsLink.addEventListener('click', (e) => {
            e.preventDefault();
            chrome.runtime.sendMessage({ action: 'openLogsPage' });
        });
    }

    saveButton.addEventListener('click', saveOptions);
    piperSelect.addEventListener('change', updatePiperSpeakerUI);
    previewVoiceButton.addEventListener('click', handlePreviewVoice);
    useFormattingToggle.addEventListener('change', updateProcessingGroupState);

    // Event listeners for navigation links
    if (popupLink) {
        popupLink.addEventListener('click', (e) => {
            e.preventDefault();
            chrome.runtime.sendMessage({ action: 'openPopupPage' });
        });
    }
    if (logsLink) {
        logsLink.addEventListener('click', (e) => {
            e.preventDefault();
            chrome.runtime.sendMessage({ action: 'openLogsPage' });
        });
    }

    initialize();
});