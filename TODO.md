# Project TODO and Refinement Plan

This document outlines the key features and manual verification steps for the Voice Gateway Controller extension, focusing on the real-time, conversational TTS implementation and the new settings panel.

## 1. Core Features Implemented

*   **Real-time, Conversational TTS:** The TTS system has been refactored to handle streaming responses from chatbots. It now buffers text as it appears on screen and speaks it sentence by sentence, creating a more natural conversational flow.
*   **DOM-Aware Sanitation:** The system now intelligently ignores unreadable content. It uses a configurable list of CSS selectors (`ttsExcludeSelectors`) to identify and filter out code blocks, UI buttons, and other non-textual elements before they are sent to the TTS engine.
*   **Advanced State Identification:** The extension now provides audio feedback for the entire lifecycle of a chatbot interaction:
    *   **Thinking:** Plays a non-intrusive audio cue when the chatbot is processing a request.
    *   **Error:** Plays a distinct audio alert when the chatbot fails to generate a response.
*   **Enhanced Settings Panel:**
    *   **New Layout:** The settings panel has been redesigned with collapsible sections for better organization.
    *   **Flexible Model Configuration:** Users can now specify custom directories for TTS and ASR models via the UI or by setting `TTS_MODELS_DIR` and `ASR_MODELS_DIR` environment variables on the server.
    *   **File Browser:** A new in-app file browser allows users to easily locate and select their local model directories.
    *   **Descriptive Tooltips:** Each setting now has a helpful tooltip to clarify its function.

## 2. Manual Verification Plan

**Setup:**
1.  Load the `chat_identifier` directory as an unpacked extension in a Chromium-based browser.
2.  Run the voice gateway server using `python3 voice_server/gateway.py`.
3.  Ensure the extension's badge shows "ON".
4.  *(Optional)* Place `thinking.mp3` and `error.mp3` files in the `chat_identifier/assets/` directory to test the audio cues.

---

**Test 1: Settings Panel UI and Functionality**
1.  Open the extension's options page.
2.  **Layout:** Verify that the settings are grouped into collapsible sections: "General", "Text-to-Speech (TTS)", "Speech-to-Text (ASR)", and "Advanced".
3.  **Tooltips:** Hover over the info icon (`ⓘ`) next to several settings (e.g., "Play audio directly in browser", "TTS Models Directory").
    *   **Expected Result:** A descriptive tooltip should appear for each icon, explaining the setting.
4.  **File Browser:**
    *   In the "Text-to-Speech (TTS)" section, click the "Browse..." button.
    *   **Expected Result:** A file browser modal should appear, showing directories from your home folder.
    *   Navigate through a few directories. Use the "Parent Directory" link to go up.
    *   Select a directory containing Piper TTS models and click "Select Current Directory".
    *   **Expected Result:** The modal should close, and the selected path should appear in the "TTS Models Directory" input field. The "Voice Model" dropdown should update to show the models from the selected directory.
5.  Repeat the file browser test for the "ASR Models Directory".

---

**Test 2: Real-time Streaming and Sanitation**
1.  Navigate to a supported chat site (e.g., `chatgpt.com`).
2.  Ask the chatbot a question that will generate a long response with multiple sentences and a code block.
3.  **Expected Result:**
    *   The extension should begin speaking the first sentence of the reply as soon as it appears.
    *   Each sentence must be spoken only once.
    *   The content within any code blocks should be ignored.
    *   The extension popup should correctly display the message counts and the final message.

---

**Test 3: Advanced State Handling (Thinking & Errors)**
1.  Navigate to a site with a visible thinking indicator (e.g., the streaming cursor on `chatgpt.com`).
2.  Submit a prompt.
3.  **Expected Result:** You should hear the "thinking" audio cue (if the file is present).
4.  (If possible) Trigger an error state on the chat page.
5.  **Expected Result:** You should hear the "error" audio cue (if the file is present).