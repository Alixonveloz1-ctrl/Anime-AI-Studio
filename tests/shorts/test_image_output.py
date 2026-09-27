import unittest
from unittest.mock import Mock
from shorts.core.contracts import ContractError
from shorts.service.config import config
from shorts.service.providers import Providers
from shorts.service.image_direction import image_prompt

class ImageOutputTests(unittest.TestCase):
    def test_visual_prompts_do_not_inherit_writer_output_or_voice_rules(self):
        entity={'id':'hero','name':'Kenji','age':25,'referencePrompt':'Cabello negro, delantal gris','costumes':['Delantal gris'],'voice':{'name':'Puck'},'objective':'Cerrar el bar','prompt':'Kenji limpia la mesa','before':{'position':'left'},'after':{'position':'left'}}
        for prompt in (image_prompt(entity),image_prompt(entity,shot=True),image_prompt(entity,variant='Mover la mano')):
            self.assertIn('Entrega la imagen renderizada',prompt)
            self.assertNotIn('Devuelve solo JSON',prompt)
            self.assertNotIn('5 minutos',prompt)
        reference=image_prompt(entity)
        self.assertIn('delantal gris',reference);self.assertNotIn('Puck',reference);self.assertNotIn('Cerrar el bar',reference)
        self.assertIn('left',image_prompt(entity,shot=True))

    def invoke(self,response):
        session=Mock();meter=Mock()
        session.post.side_effect=[Mock(ok=True,status_code=200,json=lambda:{'totalTokens':20}),Mock(ok=True,status_code=200,json=lambda:response)]
        provider=Providers(config(),session,meter)
        return provider,session,meter

    def test_text_only_response_is_not_an_image_and_never_retries(self):
        provider,session,meter=self.invoke({'candidates':[{'finishReason':'STOP','content':{'parts':[{'text':'{"privateStory":"secret"}'}]}}]})
        with self.assertRaises(ContractError) as error:provider.image('Draw Kenji',[],'16:9')
        self.assertEqual(error.exception.code,'IMAGE_TEXT_ONLY');self.assertEqual(session.post.call_count,2)
        summary=meter.record_image_response.call_args.args[0]
        self.assertEqual(summary,{'finishReason':'STOP','blocked':False,'textParts':1,'imageParts':0})
        self.assertNotIn('secret',str(summary));meter.begin_call.assert_called_once()

    def test_empty_blocked_truncated_and_unsafe_outputs_are_distinguished(self):
        for response,code in [
            ({'candidates':[]},'IMAGE_MISSING'),
            ({'promptFeedback':{'blockReason':'SAFETY'}},'IMAGE_BLOCKED'),
            ({'candidates':[{'finishReason':'IMAGE_SAFETY'}]},'IMAGE_BLOCKED'),
            ({'candidates':[{'finishReason':'MAX_TOKENS'}]},'IMAGE_TRUNCATED'),
            ({'candidates':[{'finishReason':'IMAGE_OTHER'}]},'IMAGE_MISSING')]:
            with self.subTest(code=code):
                provider,session,meter=self.invoke(response)
                with self.assertRaises(ContractError) as error:provider.image('Draw Kenji',[],'16:9')
                self.assertEqual(error.exception.code,code);self.assertEqual(session.post.call_count,2)

    def test_only_final_image_is_saved_and_corrupt_bytes_are_rejected(self):
        provider,_,_=self.invoke({'candidates':[{'finishReason':'STOP','content':{'parts':[
            {'thought':True,'inlineData':{'mimeType':'image/png','data':'dGhvdWdodA=='}},
            {'inlineData':{'mimeType':'image/png','data':'ZmluYWw='}}]}}]})
        self.assertEqual(provider.image('Draw Kenji',[],'16:9'),(b'final','image/png'))
        provider,_,_=self.invoke({'candidates':[{'content':{'parts':[{'inlineData':{'mimeType':'image/png','data':'INVALID!'}}]}}]})
        with self.assertRaises(ContractError) as error:provider.image('Draw Kenji',[],'16:9')
        self.assertEqual(error.exception.code,'IMAGE_INVALID')

if __name__=='__main__':unittest.main()
