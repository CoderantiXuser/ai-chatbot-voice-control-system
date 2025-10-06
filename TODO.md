# Project TODO and Refinement Plan

This document outlines the key features and manual verification steps for the Voice Gateway Controller extension, focusing on the real-time, conversational TTS implementation.

## 1. Core Features Implemented

*   **Real-time, Conversational TTS:** The TTS system has been refactored to handle streaming responses from chatbots. It now buffers text as it appears on screen and speaks it sentence by sentence, creating a more natural conversational flow.
*   **DOM-Aware Sanitation:** The system now intelligently ignores unreadable content. It uses a configurable list of CSS selectors (`ttsExcludeSelectors`) to identify and filter out code blocks, UI buttons, and other non-textual elements before they are sent to the TTS engine.
*   **Advanced State Identification:** The extension now provides audio feedback for the entire lifecycle of a chatbot interaction:
    *   **Thinking:** Plays a non-intrusive audio cue when the chatbot is processing a request.
    *   **Error:** Plays a distinct audio alert when the chatbot fails to generate a response.
*   **WebSocket-based ASR:** The ASR system has been modernized to use WebSockets, providing faster and more efficient transcription.
*   **"Play in Browser" Fixed:** The server now correctly sends audio data to the client, allowing TTS to be played directly in the browser.

## 2. Manual Verification Plan

**Setup:**
1.  Load the `chat_identifier` directory as an unpacked extension in a Chromium-based browser.
2.  Run the voice gateway server using `python3 voice_server/gateway.py`.
3.  Ensure the extension's badge shows "ON".
4.  *(Optional)* Place `thinking.mp3` and `error.mp3` files in the `chat_identifier/assets/` directory to test the audio cues. If the files are not present, the extension will log a warning to the service worker console but will not crash.

---

**Test 1: Real-time Streaming and Sanitation (CRITICAL TEST)**
1.  Navigate to a supported chat site (e.g., `chatgpt.com`).
2.  Ask the chatbot a question that will generate a long response with multiple sentences and a code block. For example: "Explain JavaScript promises in three sentences and provide a code example."
3.  **Expected Result:**
    *   The extension should begin speaking the first sentence of the reply as soon as it appears.
    *   **Crucially, each sentence must be spoken only once.** As new sentences appear, they should be spoken sequentially without repeating the previous ones. This confirms the streaming buffer fix.
    *   The content within any code blocks (`<pre>` or `<code>` elements) should be completely ignored by the TTS engine.
    *   The extension popup should correctly display the total number of user and bot messages, and the "Last Message" preview should show the final, complete message from the bot.

---

**Test 2: "Play in Browser" Functionality**
1.  Go to the extension's options page.
2.  Enable the setting **"Play audio directly in the browser"**.
3.  Trigger a TTS response from a chatbot.
4.  **Expected Result:** The audio should play from your browser. You should not hear any audio coming from the machine where the Python server is running.

---

**Test 3: Advanced State Handling (Thinking & Errors)**
1.  Navigate to a site with a visible thinking indicator (e.g., the streaming cursor on `chatgpt.com` or the pulsing dots on `claude.ai`).
2.  Submit a prompt.
3.  **Expected Result:** As soon as the thinking indicator appears, you should hear the "thinking" audio cue (if the file is present).
4.  (If possible) Trigger an error state on the chat page (e.g., by causing a network error or using a prompt that the model rejects).
5.  **Expected Result:** As soon as the error message appears, you should hear the "error" audio cue (if the file is present).

---

**Test 4: ASR via WebSockets (Regression Test)**
1.  Click the extension popup, select a VOSK model, and click **"Start ASR"**.
2.  Click on the chat input box and speak a phrase.
3.  **Expected Result:** The recognized text should appear in the input box in near real-time. The browser's developer tools should show no polling requests to `/api/asr/results`.
4.  Click **"Stop ASR"** and confirm it stops.