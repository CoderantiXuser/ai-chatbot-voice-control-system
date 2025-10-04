# Project TODO and Refinement Plan

This document outlines the key areas for improvement and bug fixes for the Voice Gateway Controller extension, based on a detailed analysis of its current architecture.

## 1. Critical Bug Fixes

### 1.1. Fix "Play in Browser" TTS Functionality
- **Issue:** The `Play in Browser` feature is non-functional. The background script expects the gateway to return audio data, but the `gateway.py` server is only designed to play audio on its own local output (`pacat`).
- **Task:**
    - Refactor the `speak_text` function in `voice_server/gateway.py`.
    - Instead of piping the `piper` audio stream to `pacat`, capture the raw audio data.
    - Return this audio data in the body of the Flask response so the background script can process it.

## 2. Major Feature: Real-time, Conversational TTS

The current TTS system waits for the entire bot reply to be generated, which feels unnatural. The goal is to refactor the system to speak the text as it appears on screen.

### 2.1. Implement Real-time Text Batching
- **Issue:** The system is not designed for streaming responses.
- **Tasks:**
    - **Content Script (`content.js`):**
        - Reconfigure the `MutationObserver` to monitor for changes *inside* the bot's reply container, not just for the container's creation.
        - Implement a text buffer that collects incoming words and batches them into sentences (e.g., sending a batch upon encountering `.`, `?`, `!`).
        - Add logic to track which sentences have already been sent to the TTS engine to prevent re-speaking.
    - **Gateway Server (`gateway.py`):**
        - Implement a server-side audio queue to handle the incoming sentence batches. This ensures that audio for a new sentence only starts after the previous one has finished playing, preventing interruptions.

### 2.2. Advanced Text Sanitation (DOM-Aware Exclusion)
- **Issue:** The current regex-based text cleaning is brittle and will fail with a streaming/batching model.
- **Tasks:**
    - **Content Script (`content.js`):**
        - Add a `ttsExcludeSelectors` array to the `SITE_CONFIG` for each site (e.g., `['pre', 'code', 'button']`).
        - As the `MutationObserver` detects new nodes, it must check if the node or any of its parents match the exclusion selectors.
        - If a node is inside an excluded element, its text content should be ignored and never added to the TTS buffer.

## 3. Advanced Chat State Identification

The current system only recognizes the final bot message. It needs to be aware of the entire lifecycle of a chatbot's reply.

### 3.1. Handle "Thinking" Indicators
- **Issue:** The extension is silent while the chatbot is processing a prompt, which can be confusing for the user.
- **Tasks:**
    - Add a `thinkingIndicatorSelector` to the `SITE_CONFIG`.
    - When this element is detected, play a short, non-intrusive audio cue to signal that the system is working.

### 3.2. Identify and Speak "Thoughts" Content
- **Issue:** For models that show their reasoning, this "thoughts" block is currently ignored.
- **Tasks:**
    - Add a `thoughtsSelector` to the `SITE_CONFIG`.
    - Implement a state machine in the identification logic that first looks for and speaks the "thoughts" content (using the batching system) before moving on to the final answer.
    - Consider making this an optional feature that can be toggled in the extension's settings.

### 3.3. Handle Failed Replies
- **Issue:** The extension does not provide any feedback if the chatbot fails to generate a reply.
- **Tasks:**
    - Add an `errorSelector` to the `SITE_CONFIG`.
    - When an error container is detected, play a distinct audio alert (e.g., "Response failed").
    - Update the extension's state to reflect the error in the popup.