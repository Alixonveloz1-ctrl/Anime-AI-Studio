import unittest
from unittest.mock import Mock
from shorts.core.contracts import ContractError
from shorts.service.release_probe import verify


class ReleaseProbeTests(unittest.TestCase):
    def test_one_image_and_one_japanese_voice_saved_separately(self):
        provider = Mock(); provider.image.return_value = (b'image', 'image/png'); provider.tts.return_value = b'audio'
        saved = []
        def save(name, raw, mime): saved.append((name,raw,mime)); return name
        result = verify(provider, save, inspect=lambda *args: {'decoded': True})
        self.assertTrue(result['ok']); self.assertEqual(len(saved), 2)
        provider.image.assert_called_once(); provider.tts.assert_called_once()
        self.assertEqual(provider.tts.call_args.args[1]['languageCode'], 'ja-JP')
        self.assertEqual(provider.tts.call_args.args[1]['name'], 'Kore')

    def test_google_rejection_is_retained_without_retry_or_false_success(self):
        provider = Mock(); provider.image.side_effect = ContractError('IMAGE_TEXT_ONLY', 'Text, not an image')
        provider.tts.return_value = b'audio'
        result = verify(provider, lambda name, *args: name, inspect=lambda *args: {})
        self.assertFalse(result['ok']); self.assertEqual(result['image']['code'], 'IMAGE_TEXT_ONLY')
        self.assertTrue(result['tts']['ok']); provider.image.assert_called_once(); provider.tts.assert_called_once()

    def test_corrupt_media_and_storage_errors_cannot_be_reported_as_ready(self):
        for which in ('inspect', 'save'):
            provider = Mock(); provider.image.return_value = (b'bad', 'image/png'); provider.tts.return_value = b'bad'
            inspect = Mock(return_value={}); save = Mock(return_value='object')
            (inspect if which == 'inspect' else save).side_effect = ValueError('private credentials must not be echoed')
            result = verify(provider, save, inspect=inspect)
            self.assertFalse(result['ok']); self.assertFalse(result['image']['ok']); self.assertFalse(result['tts']['ok'])
            self.assertNotIn('credentials', str(result)); provider.image.assert_called_once(); provider.tts.assert_called_once()


if __name__ == '__main__': unittest.main()
