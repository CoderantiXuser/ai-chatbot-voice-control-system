import unittest
from unittest.mock import MagicMock
import os
import sys

# Add the parent directory to the path to allow module imports
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '.')))

from gateway import VoiceGateway

class TestGateway(unittest.TestCase):

    def setUp(self):
        """Set up a fresh VoiceGateway instance for each test."""
        self.gateway = VoiceGateway()
        # Mock the socketio object to prevent errors during testing.
        self.gateway.socketio = MagicMock()
        self.gateway.log_history.clear()

    def test_log_event_correctly_handles_numeric_level(self):
        """
        Tests that log_event no longer crashes when given a numeric level
        and correctly processes the log entry. This is the fix verification.
        """
        # Call log_event with a numeric level (e.g., 1 for INFO).
        self.gateway.log_event(
            event="Numeric Level Test",
            details="This call uses a numeric log level.",
            status="Info",
            level=1  # The call that previously crashed
        )

        # Verify that the log was added.
        self.assertEqual(len(self.gateway.log_history), 1, "Log history should contain one entry.")

        # Verify the content of the processed log.
        processed_log = self.gateway.log_history[0]
        self.assertEqual(processed_log['event'], "Numeric Level Test")

        # Verify that the numeric level was correctly stored.
        self.assertEqual(processed_log['level'], 1, "The numeric log level should be correctly stored.")

    def test_handle_extension_log_integration(self):
        """
        Tests the full flow from the (mocked) SocketIO 'extension_log' event
        to ensure the fix works at the integration point.
        """
        # Prepare a sample log entry from the extension.
        log_from_extension = {
            'level': 2,  # Numeric level for WARN
            'event': 'Extension Event Test',
            'details': 'This log comes from the extension.',
            'status': 'Warn',
            'triggerId': 'test_case_integration'
        }

        # Simulate the logic within the SocketIO handler to test the outcome.
        numeric_level = log_from_extension.get('level')
        level_str = self.gateway.LEVEL_NAMES_BY_VALUE.get(numeric_level, 'INFO')

        self.gateway.log_event(
            event=log_from_extension.get('event'),
            details=log_from_extension.get('details'),
            status=log_from_extension.get('status'),
            trigger_id=log_from_extension.get('triggerId'),
            level=level_str
        )

        # Assertions
        self.assertEqual(len(self.gateway.log_history), 1)
        processed_log = self.gateway.log_history[0]
        self.assertEqual(processed_log['event'], 'Extension Event Test')
        self.assertEqual(processed_log['level'], 2, "The numeric level from the extension should be correctly stored.")

    def test_tts_api_returns_audio_data(self):
        """
        Tests if the /api/tts endpoint correctly returns audio data.
        """
        # 1. Mock the speak_text function to avoid actual TTS generation
        #    and to control its output for the test.
        mock_audio_data = b'\x01\x02\x03\x04'
        self.gateway.speak_text = MagicMock(return_value=(mock_audio_data, None))

        # 2. Use the Flask test client to simulate a request.
        with self.gateway.app.test_client() as client:
            response = client.post(
                '/api/tts',
                json={
                    'text': 'Hello, world!',
                    'model': 'en_US-lessac-medium.onnx' # A dummy model path
                }
            )

            # 3. Assertions to verify the response.
            self.assertEqual(response.status_code, 200, "Response status code should be 200 OK.")
            # We check the raw 'Content-Type' header directly, as `response.mimetype` strips parameters.
            self.assertEqual(response.headers['Content-Type'], "audio/l16; rate=22050; channels=1", "Content-Type header should be precise.")
            self.assertEqual(response.data, mock_audio_data, "Response data should match the mocked audio data.")

            # 4. Verify that the mocked function was called correctly.
            self.gateway.speak_text.assert_called_once_with(
                text='Hello, world!',
                model='en_US-lessac-medium.onnx'
            )


if __name__ == '__main__':
    unittest.main()