# Project TODO and Refinement Plan

This document outlines the key features and manual verification steps for the Voice Gateway Controller extension.

## 1. Core Features Implemented

*   **Real-time, Conversational TTS:** The TTS system has been refactored to handle streaming responses from chatbots. It now buffers text as it appears on screen and speaks it sentence by sentence.
*   **DOM-Aware Sanitation:** The system intelligently ignores unreadable content like code blocks and UI elements.
*   **Advanced State Identification:** The extension provides audio feedback for "thinking" and "error" states.
*   **Enhanced Settings Panel:** The settings panel has been redesigned with a clearer layout, tooltips, and a file browser for selecting local model directories.
*   **Chat History Download:** Users can now download the full chat history of a conversation as a `.md` or `.txt` file.

## 2. Manual Verification Plan

**Setup:**
1.  Load the `chat_identifier` directory as an unpacked extension in a Chromium-based browser.
2.  Run the voice gateway server using `python3 voice_server/gateway.py`.
3.  Ensure the extension's badge shows "ON".

---

**Test 1: Chat History Download**
1.  Navigate to a supported chat site (e.g., `chatgpt.com`) and have a conversation with several turns.
2.  Scroll up part-way so that the beginning of the conversation is not visible on the screen.
3.  Click the extension popup icon. The "Download" button should be enabled.
4.  Select "Markdown (.md)" from the format dropdown and click **Download**.
5.  **Expected Result:** A "Save As" dialog should appear, prompting you to save a `.md` file.
6.  Save the file and open it. The file should contain the **entire** conversation history, correctly formatted with `### User` and `### Bot` headers for each message.
7.  Repeat steps 4-6, but select "Text (.txt)" format.
8.  **Expected Result:** A `.txt` file should be downloaded, containing the entire history with `[USER]` and `[BOT]` labels.

---

**Test 2: Real-time Streaming and Sanitation**
1.  Ask a chatbot a question that will generate a long response with multiple sentences and a code block.
2.  **Expected Result:** Each sentence should be spoken only once, sequentially. The content within code blocks should be ignored. The popup UI should update correctly after the message is complete.

---

**Test 3: Advanced State Handling (Thinking & Errors)**
1.  Navigate to a site with a visible thinking indicator (e.g., `claude.ai`).
2.  Submit a prompt.
3.  **Expected Result:** You should hear the "thinking" audio cue (if `thinking.mp3` is placed in the `assets` folder).

---

**Test 4: ASR & "Play in Browser" (Regression Test)**
1.  Test the ASR functionality to ensure it still works.
2.  Go to the options page, enable "Play audio directly in browser", and trigger a TTS response.
3.  **Expected Result:** ASR should work as before. TTS audio should play from the browser, not the server.