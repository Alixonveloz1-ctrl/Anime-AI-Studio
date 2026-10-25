"""Sounds a person can actually obtain, and voices you can tell apart."""
import importlib.util
import unittest
from unittest.mock import patch
from shorts.core.contracts import ContractError,AMBIENCE_LOOP_SECONDS,SFX_MAX_SECONDS,sound_group_uses
from shorts.core.requests import VOICES,VOICE_GENDERS
from shorts.service.development import plan_sound,validate_stage
from shorts.service.director import validate_development
from shorts.service.timeline import ambience_placements
from test_manual_development import complete


def request(**fields):
    base={'id':'s1','name':'Puerta','description':'Cierre seco','prompt':'Metal door closing',
          'type':'sfx','seconds':2.0,'preparationSeconds':0.2,'tailSeconds':0.4,
          'perspective':'Cerca','shotId':'shot1','eventDescription':'La puerta toca el marco','required':True}
    return {**base,**fields}


class SoundPlanTests(unittest.TestCase):
    def test_an_effect_of_315_seconds_becomes_an_ambience_loop_that_can_be_obtained(self):
        # The plan for a five-minute short asked for the whole room tone as one
        # 315-second file. Nobody can go and fetch that.
        plan=plan_sound({'soundRequests':[request(prompt='Lluvia sobre tejas',seconds=315,preparationSeconds=4,tailSeconds=4)]})
        sound=plan['soundRequests'][0]
        self.assertEqual(sound['type'],'ambience')
        self.assertEqual(sound['seconds'],AMBIENCE_LOOP_SECONDS)
        self.assertEqual((sound['preparationSeconds'],sound['tailSeconds']),(0.0,0.0))

    def test_an_effect_longer_than_a_hit_is_treated_as_the_bed_it_really_is(self):
        sound=plan_sound({'soundRequests':[request(seconds=90)]})['soundRequests'][0]
        self.assertEqual(sound['type'],'ambience')
        self.assertEqual(sound['seconds'],AMBIENCE_LOOP_SECONDS)

    def test_a_hit_within_its_limit_is_left_exactly_as_the_plan_wrote_it(self):
        asked=request(seconds=SFX_MAX_SECONDS,preparationSeconds=1,tailSeconds=2)
        sound=plan_sound({'soundRequests':[asked]})['soundRequests'][0]
        self.assertEqual(sound['type'],'sfx')
        self.assertEqual((sound['seconds'],sound['preparationSeconds'],sound['tailSeconds']),(float(SFX_MAX_SECONDS),1.0,2.0))

    def test_the_same_sound_in_two_shots_is_one_upload_and_the_same_shot_twice_is_one_request(self):
        plan=plan_sound({'soundRequests':[
            request(id='a',shotId='shot1'),
            request(id='b',shotId='shot2',prompt='  METAL  door   closing '),
            request(id='c',shotId='shot1'),
            request(id='d',shotId='shot3',prompt='Pasos sobre grava'),
        ]})
        kept=[r['id'] for r in plan['soundRequests']]
        self.assertEqual(kept,['a','b','d'],'La misma solicitud repetida en la misma toma no son dos sonidos')
        groups={r['id']:r['soundGroup'] for r in plan['soundRequests']}
        self.assertEqual(groups['a'],groups['b'],'El mismo sonido en otra toma comparte archivo')
        self.assertNotEqual(groups['a'],groups['d'])
        rows=plan['soundRequests']
        self.assertEqual([r['id'] for r in sound_group_uses(rows,'a')],['b'])
        self.assertEqual(sound_group_uses(rows,'a',{'b'}),[],'Una toma que ya tiene su cue no se coloca otra vez')
        self.assertEqual(sound_group_uses(rows,'d'),[])

    def test_margins_that_do_not_fit_are_shrunk_instead_of_failing_the_whole_step(self):
        sound=plan_sound({'soundRequests':[request(seconds=1,preparationSeconds=2,tailSeconds=2)]})['soundRequests'][0]
        self.assertLessEqual(sound['preparationSeconds']+sound['tailSeconds'],sound['seconds'])

    def test_a_saved_story_without_the_new_fields_is_still_valid(self):
        old=complete()
        old['soundRequests']=[{k:v for k,v in request().items() if k!='type'}]
        old['soundRequests'][0]['shotId']=old['shots'][0]['id']
        validate_development(old)

    def test_a_typed_request_longer_than_its_kind_allows_is_refused_with_a_reason(self):
        data=complete()
        data['soundRequests']=[request(seconds=300,shotId=data['shots'][0]['id'],type='ambience')]
        with self.assertRaises(ContractError) as error:validate_development(data)
        self.assertEqual(error.exception.code,'SOUND_DURATION')
        self.assertIn('bucle corto',str(error.exception))

    def test_the_sound_step_normalises_what_it_saves(self):
        data=complete()
        data['soundRequests']=[request(seconds=315,shotId=data['shots'][0]['id'])]
        saved=validate_stage(data,3)['soundRequests'][0]
        self.assertEqual(saved['type'],'ambience');self.assertEqual(saved['seconds'],AMBIENCE_LOOP_SECONDS)
        self.assertTrue(saved['soundGroup'])


class AmbienceLoopTests(unittest.TestCase):
    shots=[{'id':'t1','startFrame':0,'frames':120,'locationId':'casa'},
           {'id':'t2','startFrame':120,'frames':240,'locationId':'casa'},
           {'id':'t3','startFrame':360,'frames':120,'locationId':'calle'}]
    cue={'id':'cue','track':'ambience','anchorShotId':'t1','anchorFrameOffset':0,'sourceSyncSample':0,
         'trimInSample':0,'trimOutSample':240000,'fadeInSamples':2000,'fadeOutSamples':2000,'approvalState':'approved'}

    def test_a_short_loop_covers_its_place_and_stops_when_the_place_changes(self):
        placements,incomplete=ambience_placements(self.shots,self.cue,240000)
        self.assertFalse(incomplete)
        self.assertEqual(len(placements),3)
        self.assertEqual(placements[0]['anchorSample'],0)
        last=placements[-1]
        self.assertEqual(last['anchorSample']+last['trimOutSample']-last['trimInSample'],360*2000)
        self.assertNotIn('anchorShotId',last,'Cada repetición lleva su propio instante exacto')
        self.assertEqual([p['fadeInSamples'] for p in placements],[2000,0,0])
        self.assertEqual([p['fadeOutSamples'] for p in placements],[0,0,2000])
        self.assertEqual(len({p['id'] for p in placements}),3)

    def test_the_last_repetition_is_trimmed_instead_of_running_past_its_place(self):
        cue={**self.cue,'trimOutSample':48000*7}
        placements,incomplete=ambience_placements(self.shots,cue,48000*7)
        self.assertFalse(incomplete)
        total=sum(p['trimOutSample']-p['trimInSample'] for p in placements)
        self.assertEqual(total,360*2000)
        self.assertLessEqual(placements[-1]['trimOutSample']-placements[-1]['trimInSample'],48000*7)

    def test_a_loop_too_short_for_its_place_says_so_instead_of_filling_silently(self):
        cue={**self.cue,'trimOutSample':2000}
        placements,incomplete=ambience_placements(self.shots,cue,2000)
        self.assertTrue(incomplete,'Un bucle de un fotograma no puede cubrir su lugar en silencio')
        self.assertTrue(placements)


class VoiceCatalogueTests(unittest.TestCase):
    def test_every_voice_says_whether_it_is_female_or_male(self):
        # Without this the only way to know who is who was to synthesise the
        # thirty of them and listen one by one.
        self.assertEqual(list(VOICE_GENDERS),VOICES)
        self.assertEqual({g for g in VOICE_GENDERS.values()},{'female','male'})

    def test_animes_and_cortos_never_disagree_about_who_is_female(self):
        # Both halves of the product classify the SAME thirty Gemini TTS voices.
        # If one table is edited alone, the app calls a voice female on one side
        # and male on the other.
        import re
        from pathlib import Path
        root=Path(__file__).resolve().parents[2]
        page=(root/'index.html').read_text(encoding='utf-8')
        table=page.split('const GENERO_POR_NOMBRE = {',1)[1].split('}',1)[0]
        animes={name.lower():gender for name,gender in re.findall(r"([A-Za-z]+)\s*:\s*'(female|male)'",table)}
        self.assertEqual(len(animes),len(VOICE_GENDERS),'Animes clasifica otro número de voces')
        self.assertEqual(animes,{name.lower():gender for name,gender in VOICE_GENDERS.items()})

    @unittest.skipUnless(importlib.util.find_spec('flask'),'Install pinned service dependencies')
    def test_the_catalogue_the_page_reads_carries_the_gender_of_each_voice(self):
        from shorts.service.app import app
        with patch('shorts.service.app.owned',return_value={'id':'p','owner':'u','revision':1}):
            answer=app.test_client().get('/projects/p/generators')
        self.assertEqual(answer.status_code,200,answer.data)
        voices=answer.json['voices']
        self.assertEqual([v['name'] for v in voices],VOICES)
        self.assertEqual(next(v['gender'] for v in voices if v['name']=='Kore'),'female')
        self.assertEqual(next(v['gender'] for v in voices if v['name']=='Puck'),'male')


if __name__=='__main__':unittest.main()
