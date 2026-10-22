import unittest
from unittest.mock import AsyncMock, patch

from app.providers.ollama_provider import OllamaProvider


class ModelRuntimeTests(unittest.IsolatedAsyncioTestCase):
    async def test_runtime_without_chat_model_is_unavailable(self):
        provider = OllamaProvider()

        with patch.object(
            provider,
            "_get_installed_model_records",
            new=AsyncMock(return_value=[]),
        ):
            result = await provider.check_connection()

        self.assertTrue(result["connected"])
        self.assertEqual(result["status"], "unavailable")
        self.assertIsNone(result["default_chat_model"])
        self.assertEqual(result["selectable_chat_models"], [])

    async def test_completion_capable_model_makes_runtime_ready(self):
        provider = OllamaProvider()
        records = [
            {
                "name": "custom-chat:latest",
                "details": {
                    "family": "custom",
                    "parameter_size": "3B",
                    "quantization_level": "Q4_K_M",
                },
            }
        ]

        with patch.object(
            provider,
            "_get_installed_model_records",
            new=AsyncMock(return_value=records),
        ), patch.object(
            provider,
            "_get_model_capabilities",
            new=AsyncMock(return_value={"completion"}),
        ):
            result = await provider.check_connection()

        self.assertTrue(result["connected"])
        self.assertEqual(result["status"], "ready")
        self.assertEqual(result["default_chat_model"], "custom-chat:latest")
        self.assertEqual(
            result["selectable_chat_models"],
            ["custom-chat:latest"],
        )


if __name__ == "__main__":
    unittest.main()
