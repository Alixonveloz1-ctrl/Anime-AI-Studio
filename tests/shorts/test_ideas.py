import copy
import json
import sys
import unittest
from pathlib import Path
from unittest.mock import Mock, patch
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'worker/montage-shorts'))
from shorts.core.contracts import validate_ideas, ContractError, digest
from shorts.core.requests import IDEAS_OUTPUT_LIMIT, TEXT_OUTPUT_LIMIT, check_call_scope
from shorts.service.director import ideas_prompt, develop_prompt
from shorts.service.providers import Providers
from shorts.service.config import config
from shorts.service.production import run_job
from shorts.service.development_schema import development_schema
from shorts.service.director import validate_development

IDEAS=[{'id':'idea'+str(n),'title':title,'premise':concept} for n,title,concept in [
    (1,'El tren','Dos desconocidos discuten sobre una maleta que nadie reclama.'),
    (2,'El turno','Una cocinera debe atender al antiguo rival que podría cerrar su local.'),
    (3,'La carta','Un padre recibe una carta que le obliga a confesar una mentira.')]]

class BriefIdeasTests(unittest.TestCase):
    def test_A013_three_titles_and_concepts_only(self):
        self.assertEqual(validate_ideas(IDEAS),IDEAS)
        for invalid in (IDEAS[:2],IDEAS+[IDEAS[0]],[None]*3):
            with self.assertRaises(ContractError):validate_ideas(invalid)
        for key,value in [('premise',' '),('premise','x'*601),('title','x'*121),('ending','unrequested')]:
            rows=copy.deepcopy(IDEAS);rows[0][key]=value
            with self.assertRaises(ContractError):validate_ideas(rows)
    def test_A013_duplicates_case_and_spacing(self):
        rows=copy.deepcopy(IDEAS);rows[1]['premise']='  '+rows[0]['premise'].upper()+'  '
        with self.assertRaises(ContractError):validate_ideas(rows)
    def test_A014_single_model_call_no_development_or_review_generation(self):
        p={'id':'p','genre':'drama','subgenres':['psicológico'],'concept':'Una mentira','format':'16:9'}
        j={'id':'job','operation':'ideas','payload':{}};cloud=Mock();cloud.c=config()
        with patch('shorts.service.production.Providers') as provider:
            provider.return_value.text.return_value=copy.deepcopy(IDEAS)
            result=run_job(cloud,j,p)
            provider.return_value.text.assert_called_once_with(ideas_prompt(p),max_output_tokens=IDEAS_OUTPUT_LIMIT)
        self.assertEqual(len(result['ideas']),3)
        self.assertEqual([c.args[1] for c in cloud.put_entity.call_args_list],['ideas']*3)
        self.assertEqual([c.args[2]['data'] for c in cloud.put_entity.call_args_list],IDEAS)
        with self.assertRaises(ContractError):check_call_scope('ideas',[{'kind':'text','state':'completed'}],'text')
    def test_A014_development_only_selected_idea(self):
        p={'id':'p','genre':'drama','subgenres':[],'concept':'','format':'16:9'}
        selected={'id':'chosen','data':IDEAS[1]};p['selectedIdea']={'id':'chosen','hash':digest(selected)}
        cloud=Mock();cloud.c=config();cloud.entity.return_value=selected
        with patch('shorts.service.production.Providers') as provider,patch('shorts.service.production.validate_development',return_value={'title':'fixture'}):
            provider.return_value.text.side_effect=[{'title':'fixture'},{'issues':[]}]
            run_job(cloud,{'id':'j','operation':'develop','payload':{'ideaId':'chosen'}},p)
            prompt=provider.return_value.text.call_args_list[0].args[0]
            self.assertIn(IDEAS[1]['premise'],prompt)
            self.assertNotIn(IDEAS[0]['premise'],prompt);self.assertNotIn(IDEAS[2]['premise'],prompt)
            self.assertIn('response_schema',provider.return_value.text.call_args_list[0].kwargs)
        cloud.entity.assert_called_once_with('p','ideas','chosen')
    def test_A014_output_limit_does_not_change_development_limit_or_model(self):
        http=Mock();http.post.side_effect=[Mock(ok=True,status_code=200,json=lambda:{'totalTokens':100}),Mock(ok=True,status_code=200,json=lambda:{'candidates':[{'content':{'parts':[{'thought':True,'text':'not the answer'},{'text':json.dumps(IDEAS)}]},'finishReason':'STOP'}]})]
        self.assertEqual(Providers(config(),http).text('brief',max_output_tokens=IDEAS_OUTPUT_LIMIT),IDEAS)
        self.assertEqual(http.post.call_args.kwargs['json']['generationConfig']['maxOutputTokens'],4096)
        self.assertIn('/gemini-3.1-pro-preview:generateContent',http.post.call_args.args[0])
        self.assertEqual(TEXT_OUTPUT_LIMIT,32768)
    def test_A014_quota_and_truncation_are_explicit_no_retry(self):
        for response,code in [(Mock(ok=False,status_code=429),'PROVIDER_QUOTA'),(Mock(ok=True,status_code=200,json=lambda:{'candidates':[{'finishReason':'MAX_TOKENS'}]}),'MODEL_TRUNCATED')]:
            http=Mock();http.post.side_effect=[Mock(ok=True,status_code=200,json=lambda:{'totalTokens':10}),response]
            with self.assertRaises(ContractError) as error:Providers(config(),http).text('brief',max_output_tokens=IDEAS_OUTPUT_LIMIT)
            self.assertEqual(error.exception.code,code);self.assertEqual(http.post.call_count,2)

class DevelopmentSchemaTests(unittest.TestCase):
    def test_A018_reference_descriptions_required_for_every_bible_kind(self):
        schema=development_schema()
        for kind in ('characters','locations','props'):
            item=schema['properties']['bible']['properties'][kind]['items']
            self.assertIn('referencePrompt',item['required'])
            self.assertEqual(item['properties']['referencePrompt']['type'],'STRING')
        # Descriptions, pauses, audiovisual content and timed tracks remain
        # structural requirements, not an alternative reduced story format.
        self.assertTrue({'bible','beats','shots','utterances','soundRequests','musicRequests','subtitles'}<=set(schema['required']))
        shot=schema['properties']['shots']['items']
        self.assertTrue({'before','after','referenceEntityIds','minFrames','maxFrames','leadFrames','tailFrames'}<=set(shot['required']))

    def test_A018_schema_reaches_real_provider_request_without_retry(self):
        schema=development_schema();http=Mock()
        http.post.side_effect=[Mock(ok=True,status_code=200,json=lambda:{'totalTokens':100}),
            Mock(ok=True,status_code=200,json=lambda:{'candidates':[{'content':{'parts':[{'text':'{"title":"Fixture"}'}]},'finishReason':'STOP'}]})]
        Providers(config(),http).text('selected story',response_schema=schema)
        request=http.post.call_args
        self.assertEqual(request.kwargs['json']['generationConfig']['responseSchema'],schema)
        self.assertEqual(request.kwargs['json']['generationConfig']['maxOutputTokens'],TEXT_OUTPUT_LIMIT)
        self.assertIn('/locations/global/publishers/google/models/gemini-3.1-pro-preview:generateContent',request.args[0])
        self.assertEqual(http.post.call_count,2) # free count + one generation

    def test_A018_invalid_reference_is_named_and_saved_without_review_or_approval(self):
        from test_workflow import development
        from shorts.service.cloud import Cloud
        for kind in ('characters','locations','props'):
            with self.subTest(kind=kind):
                raw=development()
                if kind=='props':raw['bible']['props']=[{'id':'book','name':'Libro','owner':'hero','state':'cerrado','referencePrompt':'libro rojo'}]
                target=raw['bible'][kind][0];del target['referencePrompt']
                original=copy.deepcopy(raw)
                p={'id':'p','genre':'drama','subgenres':[],'concept':'','format':'16:9','activeDevelopment':'approved-old'}
                idea={'id':'chosen','data':IDEAS[0]};p['selectedIdea']={'id':'chosen','hash':digest(idea)}
                cloud=Cloud.__new__(Cloud);cloud.c=config();cloud.http=Mock();cloud.db=Mock();cloud.entity=Mock(return_value=idea)
                with patch('shorts.service.production.Providers') as provider:
                    provider.return_value.text.return_value=raw
                    with self.assertRaises(ContractError) as error:
                        run_job(cloud,{'id':'job','operation':'develop','payload':{'ideaId':'chosen'}},p)
                    self.assertEqual(error.exception.code,'DEVELOPMENT_TEXT')
                    self.assertIn('descripción visual de referencia',str(error.exception))
                    self.assertIn(target['name'],str(error.exception))
                    provider.return_value.text.assert_called_once()
                ref=cloud.db.collection.return_value.document.return_value.collection.return_value.document.return_value
                saved=ref.create.call_args.args[0]
                self.assertEqual(saved['data'],original);self.assertEqual(raw,original)
                self.assertEqual(saved['approvalState'],'incomplete')
                self.assertEqual(ref.update.call_args.args[0]['status'],'invalid')
                kinds=[c.args[0] for c in cloud.db.collection.return_value.document.return_value.collection.call_args_list]
                self.assertEqual(set(kinds),{'developmentDrafts'})
                self.assertEqual(p['activeDevelopment'],'approved-old')

    def test_A018_valid_development_remains_candidate_after_review(self):
        from test_workflow import development
        raw=development();original=copy.deepcopy(raw)
        p={'id':'p','genre':'drama','subgenres':[],'concept':'','format':'16:9'}
        idea={'id':'chosen','data':IDEAS[0]};p['selectedIdea']={'id':'chosen','hash':digest(idea)}
        cloud=Mock();cloud.c=config();cloud.entity.return_value=idea
        with patch('shorts.service.production.Providers') as provider:
            provider.return_value.text.side_effect=[raw,{'issues':[]}]
            result=run_job(cloud,{'id':'job','operation':'develop','payload':{'ideaId':'chosen'}},p)
            self.assertEqual(provider.return_value.text.call_count,2)
        self.assertEqual([c.args[1] for c in cloud.put_entity.call_args_list],['developmentDrafts','developments'])
        candidate=cloud.put_entity.call_args.args[2]
        self.assertEqual(result['developmentId'],candidate['id'])
        self.assertEqual(candidate['approvalState'],'candidate');self.assertEqual(candidate['data'],original)
        cloud.mutate.assert_not_called()

    def test_A020_schema_does_not_bypass_duration_or_continuity_checks(self):
        from test_workflow import development
        for change in ('duration','reference'):
            d=development()
            if change=='duration':d['shots'][0]['frames']=7100
            else:d['shots'][0]['referenceEntityIds']=[]
            with self.assertRaises(ContractError):validate_development(d)

if __name__=='__main__':unittest.main()
