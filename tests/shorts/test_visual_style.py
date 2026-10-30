import unittest
from shorts.core.contracts import ContractError
from shorts.core.requests import VISUAL_STYLES, selected_models, visual_style
from shorts.service.config import config
from shorts.service.director import develop_prompt, rules_for
from shorts.service.image_direction import image_prompt, video_prompt

class VisualStyleTests(unittest.TestCase):
    def test_styles_are_exactly_the_two_offered(self):
        self.assertEqual(set(VISUAL_STYLES), {'anime_cinematografico', 'realista'})

    def test_default_is_anime_cinematic_and_models_ignore_style_key(self):
        self.assertEqual(visual_style({}), 'anime_cinematografico')
        self.assertEqual(visual_style(None), 'anime_cinematografico')
        models = selected_models(config(), {'image': 'gemini-3-pro-image', 'visualStyle': 'realista'})
        self.assertEqual(models['image']['model'], 'gemini-3-pro-image')
        with self.assertRaises(ContractError):
            visual_style({'visualStyle': 'cartoon'})

    def test_realistic_prompts_never_claim_cartoon_or_anime(self):
        entity = {'name': 'Marta', 'age': 30, 'referencePrompt': 'Pelo largo'}
        prompt = image_prompt(entity, style='realista')
        self.assertIn('fotorrealista', prompt)
        self.assertIn('Entrega la imagen renderizada', prompt)
        self.assertNotIn('anime', prompt.lower().replace('sin anime', ''))
        self.assertIn('Sin dibujo, sin anime', prompt)

    def test_anime_cinematic_prompts_reject_childish_style(self):
        prompt = image_prompt({'name': 'Marta', 'age': 30}, style='anime_cinematografico')
        self.assertIn('anime cinematográfico detallado y maduro', prompt)
        self.assertIn('Sin estilo infantil', prompt)
        self.assertNotIn('sombras cel', prompt)

    def test_director_prompt_follows_project_style(self):
        base = {'genre': 'Drama', 'subgenres': [], 'concept': '', 'format': '16:9'}
        idea = {'id': 'idea1'}
        self.assertIn('fotorrealista', develop_prompt({**base, 'generators': {'visualStyle': 'realista'}}, idea))
        self.assertIn('anime cinematográfico', develop_prompt(base, idea))
        self.assertIn('pelo largo', rules_for('realista'))
        self.assertIn('pelo largo', rules_for('anime_cinematografico'))


class VideoDirectionTests(unittest.TestCase):
    """Veo recibía la acción y el estilo, pero nada que sostenga la toma."""

    def test_the_clip_must_continue_its_first_frame_and_never_cut_inside(self):
        # La imagen aprobada es el primer fotograma. Sin decirlo, Veo cambia de
        # ropa o de luz; y un corte interno parte la toma en dos en el montaje.
        prompt = video_prompt('Haru cruza el andén')
        self.assertIn('Continúa exactamente el primer fotograma', prompt)
        self.assertIn('UN SOLO PLANO CONTINUO', prompt)
        self.assertIn('no cortes', prompt)
        self.assertIn('Haru cruza el andén', prompt)

    def test_the_video_carries_the_orientation_rule_the_images_already_had(self):
        self.assertIn('cielo arriba, suelo abajo', video_prompt('Camina'))
        self.assertIn('cielo arriba, suelo abajo', image_prompt({'name': 'Marta'}))

    def test_the_video_follows_the_chosen_style_and_keeps_the_fiction_context(self):
        # Sin el contexto ficticio un plano realista con un arma vuelve vacío.
        for style in ('anime_cinematografico', 'realista'):
            with self.subTest(style=style):
                prompt = video_prompt('Apunta el arma', style)
                self.assertTrue(prompt.startswith('Fictional science-fiction survival story'))
                self.assertIn('not real people', prompt)
        self.assertIn('fotorrealista', video_prompt('Camina', 'realista'))
        self.assertIn('anime cinematográfico', video_prompt('Camina', 'anime_cinematografico'))
        self.assertIn('anime cinematográfico', video_prompt('Camina'))

    def test_an_unknown_style_is_refused_instead_of_silently_becoming_anime(self):
        with self.assertRaises(ContractError):
            video_prompt('Camina', 'cartoon')


if __name__ == '__main__':
    unittest.main()
