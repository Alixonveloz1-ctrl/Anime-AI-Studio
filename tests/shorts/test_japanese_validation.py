import unittest
from shorts.core.contracts import ContractError
from shorts.service.director import has_japanese, validate_development
from tests.shorts.test_manual_development import complete

class JapaneseValidationTests(unittest.TestCase):
    def test_japanese_detection(self):
        self.assertTrue(has_japanese('こんにちは'))
        self.assertTrue(has_japanese('今日は元気です'))
        self.assertFalse(has_japanese('Hola, ¿cómo estás?'))
        self.assertFalse(has_japanese('Konnichiwa'))
        self.assertFalse(has_japanese(''))

    def test_script_with_spanish_only_japanese_is_rejected_before_voice(self):
        d = complete()
        d['utterances'][0]['japanese'] = 'Hola, ¿cómo estás?'
        with self.assertRaises(ContractError) as error:
            validate_development(d)
        self.assertEqual(error.exception.code, 'JAPANESE')

    def test_script_with_real_japanese_passes(self):
        d = complete()
        d['utterances'][0]['japanese'] = 'こんにちは、元気ですか'
        self.assertEqual(validate_development(d)['utterances'][0]['japanese'], 'こんにちは、元気ですか')

if __name__ == '__main__':
    unittest.main()
