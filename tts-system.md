# TTS System Architecture Documentation

This document provides a comprehensive overview of the Text-to-Speech (TTS) feature within the Voice Gateway Controller extension. It details the system's architecture, the end-to-end workflow of processing and speaking text, and a mapping of specific logic to the relevant files and functions in the codebase.

## 1. High-Level Overview

The TTS feature is designed to provide a real-time, conversational audio experience for users interacting with modern web chatbots. Unlike traditional TTS systems that read a full block of text after it has been generated, this system is architected to handle **streaming responses**. It processes text as it appears on the screen, batches it into sentences, and speaks them sequentially, creating a more natural and immediate audio feedback loop.

The system is built on a three-part architecture:
1.  **Content Script (`content.js`):** The "eyes and ears" on the page. It detects new text, sanitizes it, and initiates the TTS process.
2.  **Background Script (`background.js`):** The "central nervous system." It manages requests, queues audio playback, and communicates with the server.
3.  **Gateway Server (`gateway.py`):** The "voice box." It receives text from the extension and uses the Piper TTS engine to generate the raw audio data.

## 2. End-to-End TTS Workflow

The following steps trace the journey of a single chatbot sentence from its appearance on the screen to being heard by the user.

### Step 1: Real-time Text Detection
- **Location:** `chat_identifier/content.js`
- **Key Components:** `initialize()`, `MutationObserver`, `handleMutations()`
- **Description:** The process begins in the `initialize` function, which sets up a `MutationObserver`. This observer is configured to efficiently watch for changes to the page's content, including both the addition of new elements (`childList`) and changes to text within existing elements (`characterData`). When a chatbot streams a new word or sentence fragment into a message block, the observer triggers the `handleMutations` function, passing along the details of what changed.

### Step 2: State Management & Buffering
- **Location:** `chat_identifier/content.js`
- **Key Components:** `ttsMessageTracker` (Map), `processBotMessage()`
- **Description:** To handle multiple simultaneous or consecutive messages without confusion, a `ttsMessageTracker` map tracks the state of each bot message element individually. When `processBotMessage` is called for a given message node, it checks the tracker. If the node is new, it's added with an empty buffer and a `processedLength` of 0. This ensures that each message has its own independent text buffer.

### Step 3: DOM-Aware Sanitation
- **Location:** `chat_identifier/content.js`
- **Key Components:** `getSanitizedText()`, `SITE_CONFIG.ttsExcludeSelectors`
- **Description:** Before processing, the `processBotMessage` function calls `getSanitizedText`. This function clones the message node in memory and uses the `ttsExcludeSelectors` array from the site's configuration (e.g., `['pre', 'code', 'button']`) to find and remove any unwanted elements. This **DOM-aware sanitation** is critical, as it prevents UI elements and code blocks from being included in the text sent for speech synthesis.

### Step 4: Sentence Batching
- **Location:** `chat_identifier/content.js`
- **Key Components:** `processBotMessage()`
- **Description:** The core streaming logic resides here. The function compares the length of the newly sanitized text against the `processedLength` stored in the tracker. The new text chunk is appended to the message's personal `buffer`. This buffer is then split into sentences using a regex that looks for sentence-ending punctuation (`.`, `?`, `!`). Only the complete sentences are sent for speech; the final, potentially incomplete sentence fragment remains in the buffer, waiting for the next text mutation. This prevents repetition and ensures only complete thoughts are spoken.

### Step 5: Request Dispatch
- **Location:** `chat_identifier/content.js`
- **Key Components:** `sendToTTSGateway()`
- **Description:** Once a complete sentence (or group of sentences) is ready, it's passed to `sendToTTSGateway`. This function reads the user's preferences from `chrome.storage.local` (selected voice model, speaker, and voice characteristics) and constructs a JSON payload. It then sends this payload to the background script via a `chrome.runtime.sendMessage` call with the action `ttsRequest`.

### Step 6: Request Queuing
- **Location:** `chat_identifier/background.js`
- **Key Components:** `ttsQueue`, `isPlaying`, `handleTtsRequest()`, `processTtsQueue()`
- **Description:** The background script acts as a robust proxy. When it receives a `ttsRequest`, it does not process it immediately. Instead, it adds the request to the `ttsQueue`. The `processTtsQueue` function ensures that only one request is sent to the server at a time by using an `isPlaying` flag. This is essential for speaking batched sentences sequentially and preventing audio from playing over itself.

### Step 7: Audio Generation
- **Location:** `voice_server/gateway.py`
- **Key Components:** `/api/tts` route, `speak_text()`
- **Description:** The background script sends a `fetch` request to the `/api/tts` endpoint on the gateway server. The server's `speak_text` function constructs a command to run the `piper` TTS engine as a `subprocess.Popen` call. Crucially, it configures the subprocess to pipe its `stdout` (which contains the raw audio data) back to the Python script.

### Step 8: Audio Data Response
- **Location:** `voice_server/gateway.py`, `chat_identifier/background.js`
- **Description:** The `speak_text` function captures the audio data from the completed `piper` process. The `/api/tts` Flask route then returns this raw data in the body of an HTTP response, setting the `Content-Type` header to `audio/l16; rate=22050; channels=1` to accurately describe the audio format.

### Step 9: Browser-Side Audio Playback
- **Location:** `chat_identifier/background.js`, `chat_identifier/content.js`
- **Description:** The `processTtsQueue` function in the background script receives the server's response. If the "Play in Browser" setting is enabled, it reads the response body as an audio `Blob`. It then uses a `FileReader` to convert this blob into a `data:URL`. This URL is sent back to the original callback in the `sendToTTSGateway` function in `content.js`. The content script then creates a new `Audio` object with this URL and calls `.play()` to play the sound directly in the browser, completing the workflow.

## 3. Implementation Mapping

| Feature/Logic | File | Key Functions/Components | Description |
| :--- | :--- | :--- | :--- |
| Real-time Text Detection | `content.js` | `initialize`, `MutationObserver`, `handleMutations` | Watches for DOM changes to detect new text as it streams in. |
| Per-Message State | `content.js` | `ttsMessageTracker` (Map) | Tracks the processing state (text buffer, amount spoken) for each bot message individually. |
| Content Sanitation | `content.js` | `getSanitizedText`, `SITE_CONFIG.ttsExcludeSelectors` | Clones the message node and removes configured HTML elements *before* text extraction to prevent speaking code/UI. |
| Sentence Batching | `content.js` | `processBotMessage` | Buffers new text fragments, identifies complete sentences, and sends them for processing. |
| TTS Request Creation | `content.js` | `sendToTTSGateway` | Gathers user settings (model, speaker, etc.) and sends the `ttsRequest` message. |
| Request & Playback Queuing | `background.js`| `ttsQueue`, `isPlaying`, `handleTtsRequest`, `processTtsQueue` | Ensures TTS requests are processed one at a time to prevent audio overlap. |
| Audio Generation | `gateway.py` | `speak_text` | Calls the `piper` TTS engine as a subprocess and captures the raw audio data from its stdout. |
| Audio Data API | `gateway.py` | `/api/tts` route | Returns the raw audio data with the correct `Content-Type` header. |
| Browser-Side Playback | `content.js` | `sendToTTSGateway` callback | Receives the `audioDataUrl` from the background script and plays it using the HTML5 `Audio` element. |
| User Configuration | `options.html`, `options.js` | N/A | Provides the UI for users to select TTS models, voice characteristics, and playback behavior. |
| Model Discovery | `gateway.py` | `scan_models` | Discovers available TTS models from paths specified by environment variables or the config file. |