import copy
import unittest
from unittest.mock import Mock,patch
from shorts.core.contracts import ContractError
from shorts.core.batches import pending_plan,batch_key
from shorts.core.dependencies import fingerprint,dependency_records
from shorts.core.events import contact_options,choose_contact
from shorts.core.timing import voice_layout,shot_bounds
from shorts.service.director import validate_development


def development():
    return {'bible':{'characters':[{'id':'hero','name':'Hero','japaneseReading':'ヒーロー','age':30,'objective':'Observe','speech':'quiet','referencePrompt':'red coat','relationships':[],'costumes':[{'id':'coat','description':'red coat'}],'voice':{'name':'Kore','languageCode':'ja-JP'}}],'locations':[{'id':'room','name':'Room','referencePrompt':'rectangular room','layout':'rectangular','entrances':[],'windows':[],'furniture':[],'light':'day','soundZones':[]}],'props':[]},
        'beats':[{'id':'beat','minFrames':1,'preferredFrames':7200,'maxFrames':7200}],
        'shots':[{'id':'shot','beatId':'beat','function':'observes','frames':7200,'minFrames':7000,'maxFrames':7200,'leadFrames':24,'tailFrames':24,'timingReason':'deliberate observation','treatment':'hold','prompt':'seated','locationId':'room','visibleCharacters':['hero'],'offscreenCharacters':[],'props':[],'before':{'position':'seated'},'after':{'position':'seated'},'referenceEntityIds':['hero','room']}],
        'utterances':[{'id':'voice','shotId':'shot','speakerId':'hero','type':'dialogue','spanish':'El libro.','japanese':'本。','acting':'calm','pauseBeforeFrames':6,'pauseAfterFrames':12}],
        'soundRequests':[],'musicRequests':[],'subtitles':[{'utteranceId':'voice','text':'El libro.'}]}

class WorkflowTests(unittest.TestCase):
    def test_A020_measured_voice_and_explicit_pauses(self):
        d=development();s=d['shots'][0];u=d['utterances'][0]
        rows,minimum=voice_layout(s,[(u,{'samples':62400})])
        # Regla del usuario 2026-10-28: la primera voz de una toma no
        # espera más de 1 s tras el cambio de toma, aunque el guion
        # pusiera lead 24 + pausa 6. El resto de pausas no se toca.
        self.assertEqual(rows[0]['offsetSample'],48000)
        self.assertEqual(minimum,92) # 1.3 s voice + 24 + 12 + 24 frames, con la primera voz a 1 s
        self.assertEqual(shot_bounds(s,minimum),(7000,7200))
        with self.assertRaises(ContractError):shot_bounds(s,7201)
    def test_a_voice_longer_than_planned_stretches_the_draft_but_not_the_export(self):
        # La duración de la toma se planeó antes de que la voz existiera. Si la
        # voz grabada no cabe, el borrador la deja caber —nunca acelerando el
        # audio— para poder verla y escucharla; exportar sigue exigiendo
        # revisar esa toma, porque cambia el metraje aprobado.
        s=development()['shots'][0]
        self.assertEqual(shot_bounds(s,7201,draft=True),(7201,7201))
        with self.assertRaises(ContractError) as error:shot_bounds(s,7201)
        self.assertEqual(error.exception.code,'SCRIPT_REVIEW')
        # Y el tope de Veo no se relaja ni en borrador: un clip no puede durar
        # más de ocho segundos.
        veo={**s,'treatment':'veo','minFrames':96,'maxFrames':144,'frames':120}
        with self.assertRaises(ContractError) as error:shot_bounds(veo,200,draft=True)
        self.assertEqual(error.exception.code,'VEO_COVERAGE')
    def test_A020_validate_plan_no_unrenderable_veo(self):
        d=development();validate_development(d)
        d['shots'][0]['treatment']='veo'
        with self.assertRaisesRegex(ContractError,'ocho|8 segundos'):validate_development(d)
    def test_A024_missing_cast_reference_rejected(self):
        d=development();d['shots'][0]['referenceEntityIds']=['room']
        with self.assertRaises(ContractError):validate_development(d)
    def test_A073_pending_skips_candidates_and_approvals(self):
        d=development()
        def a(eid,state):return {'id':eid+'asset','entityId':eid,'kind':'image','sha256':'a'*64,'approvalState':state,'inputFingerprint':fingerprint(d,eid,'image')}
        hero=a('hero','approved');room=a('room','candidate')
        nodes={n['entityId']:n for n in pending_plan(d,'dev',[hero,room],[])}
        self.assertEqual(nodes['hero']['state'],'approved');self.assertEqual(nodes['room']['state'],'review')
        self.assertEqual(nodes['shot']['state'],'blocked');self.assertEqual(nodes['voice']['state'],'ready')
        room['approvalState']='approved';shot=a('shot','candidate');shot['dependencies']=dependency_records([hero,room])
        self.assertEqual(next(n for n in pending_plan(d,'dev',[hero,room,shot],[]) if n['entityId']=='shot')['state'],'review')
        hero2={**hero,'id':'new','approvedAt':3}
        self.assertEqual(next(n for n in pending_plan(d,'dev',[hero,room,shot,hero2],[]) if n['entityId']=='shot')['state'],'ready')
    def test_A074_batch_unknown_not_retried(self):
        d=development();j={'id':'job','operation':'tts','payload':{'entityId':'voice','developmentId':'dev'},'state':'submitted_unknown'}
        node=next(n for n in pending_plan(d,'dev',[],[j]) if n['entityId']=='voice')
        self.assertEqual(node['state'],'working');self.assertEqual(node['jobId'],'job')
        self.assertEqual(batch_key({'id':'b'},node),batch_key({'id':'b'},copy.deepcopy(node)))
    def test_A054_second_contact_never_defaults_to_first(self):
        options=contact_options({'visible':True,'occurrences':[{'seconds':2.5,'description':'first'},{'seconds':5.2,'description':'second'}]},8)
        self.assertIsNone(choose_contact(options))
        self.assertEqual(choose_contact(options,1)['seconds'],5.2)
        with self.assertRaises(ContractError):choose_contact(options,2)
        with self.assertRaises(ContractError):contact_options({'visible':False,'approxSeconds':2},8)

class UploadTests(unittest.TestCase):
    def setUp(self):
        from shorts.service.app import app
        self.client=app.test_client();self.p={'id':'p','owner':'u','revision':1,'activeDevelopment':'dev'}
        self.record={'id':'a','size':1234,'mimeType':'audio/mpeg','object':'obj','uploadUrl':'https://storage.googleapis.com/session','revision':1}
        self.cloud=Mock();self.cloud.entity.return_value={'data':{'soundRequests':[{'id':'effect'}]}}
        self.cloud.entity_ref.return_value.get.return_value.to_dict.return_value=self.record
        self.cloud.blob.return_value.exists.return_value=False
    def send(self):
        with patch('shorts.service.app.owned',return_value=self.p),patch('shorts.service.app.cloud',return_value=self.cloud):
            return self.client.post('/projects/p/sound-requests/effect/upload-session',json={'mime':'audio/mpeg','size':1234,'fileKey':'a'*64,'renew':True},headers={'If-Match':'1'})
    def test_A045_completed_object_no_second_upload(self):
        self.cloud.blob.return_value.exists.return_value=True
        r=self.send();self.assertTrue(r.json['complete']);self.cloud.http.put.assert_not_called()
    def test_A045_expired_session_renews_same_object(self):
        self.cloud.http.put.return_value.status_code=410
        self.cloud.blob.return_value.create_resumable_upload_session.return_value='https://storage.googleapis.com/new'
        with patch('google.cloud.firestore.transactional',side_effect=lambda f:f):r=self.send()
        self.assertEqual(r.status_code,200);self.assertTrue(r.json['restarted'])
        self.assertEqual(r.json['uploadUrl'],'https://storage.googleapis.com/new')
        self.cloud.blob.assert_called_with('p','obj')
        self.cloud.put_entity.assert_not_called()
    def test_A045_uncertain_status_does_not_restart(self):
        self.cloud.http.put.return_value.status_code=503
        r=self.send();self.assertEqual(r.status_code,503)
        self.cloud.blob.return_value.create_resumable_upload_session.assert_not_called()

class EditorialIntegrationTests(unittest.TestCase):
    def test_A010_import_copies_definition_and_provenance_only_explicitly(self):
        from shorts.core.imports import import_candidate
        d=development();source=copy.deepcopy(d);source['bible']['characters'][0]['name']='Imported name'
        asset={'id':'original','entityId':'hero','kind':'image','projectId':'other','developmentId':'old','sha256':'f'*64,'approvalState':'approved'}
        candidate,metadata=import_candidate(asset,source,d,'hero')
        self.assertEqual(candidate['bible']['characters'][0]['name'],'Imported name')
        self.assertEqual(d['bible']['characters'][0]['name'],'Hero');self.assertEqual(metadata['dependencies'],[])
        self.assertTrue(metadata['provenance']['explicit']);self.assertEqual(metadata['provenance']['projectId'],'other')
        with self.assertRaises(ContractError):import_candidate({**asset,'approvalState':'candidate'},source,d,'hero')
        with self.assertRaises(ContractError):import_candidate(asset,source,d,'room')
    def test_A038_mouth_activity_is_local_and_audio_bound(self):
        from shorts.core.mouth import activity_intervals,mouth_frames
        energy=[0]*40+[.1]*40+[0]*40+[.1]*40+[0]*40
        intervals=activity_intervals(energy)
        # Maps, not pairs: Firestore rejects an array inside an array.
        self.assertEqual(intervals,[{'start':9600,'end':19200},{'start':28800,'end':38400}])
        audio={'samples':48000,'waveform':{'voiceActivity':intervals}}
        self.assertEqual(mouth_frames(audio,48000,72),[{'start':28,'end':34},{'start':38,'end':44}])
        self.assertEqual(mouth_frames(audio,48000,72,30,40),[{'start':30,'end':34},{'start':38,'end':40}])
        # Pairs written by older code are still read.
        legacy={'samples':48000,'waveform':{'voiceActivity':[[9600,19200],[28800,38400]]}}
        self.assertEqual(mouth_frames(legacy,48000,72),mouth_frames(audio,48000,72))
    def test_A077_known_operation_resume_without_financial_gate(self):
        from shorts.core.recovery import resume_known
        job={'state':'waiting_provider','providerOperation':'known','operation':'veo','started':100,'providerCalls':[]}
        new=resume_known(job)
        self.assertEqual(new['providerOperation'],'known');self.assertEqual(new['pollAttempts'],1)
        self.assertNotIn('pollAttempts',job)
        with self.assertRaises(ContractError):resume_known({**job,'providerOperation':None})
        with self.assertRaises(ContractError):resume_known({**job,'state':'submitted_unknown'})

class InputBoundaryTests(unittest.TestCase):
    def test_A015_idea_fix_cannot_rewrite_other_fields(self):
        from shorts.core.revisions import idea_scope
        idea={'id':'idea','title':'Original','premise':'A meeting','ending':'Open'}
        candidate=idea_scope(idea,{'field':'ending'},{'id':'idea','ending':'Reconciliation','premise':'Unrequested rewrite'})
        self.assertEqual(candidate['premise'],'A meeting');self.assertEqual(candidate['ending'],'Reconciliation')
        self.assertEqual(idea['ending'],'Open')
    def test_A029_missing_reference_blocks_before_dispatch(self):
        from shorts.core.generation import generation_inputs
        d=development()
        with self.assertRaises(ContractError):generation_inputs(d,'dev',[],{},'image','shot')
        with self.assertRaises(ContractError):generation_inputs(d,'dev',[],{},'veo','shot')
        generation_inputs(d,'dev',[],{},'image','hero')
    def test_A079_json_arrays_and_null_rejected(self):
        from shorts.service.app import app
        with patch('shorts.service.app.uid',return_value='u'),patch('shorts.service.app.cloud'):
            for data in ('[]','null','true','NaN'):
                r=app.test_client().post('/projects',data=data,content_type='application/json')
                self.assertEqual(r.status_code,400)

class VocalTrimTests(unittest.TestCase):
    def test_a_parenthetical_vocal_sound_is_trimmed_to_its_shot_but_dialogue_is_not(self):
        from shorts.core.timing import voice_layout
        s=development()['shots'][0]
        s={**s,'frames':240,'minFrames':240,'maxFrames':240,'leadFrames':24,'tailFrames':24}
        vocal={'id':'breath','shotId':'shot','speakerId':'hero','type':'dialogue','spanish':'(Respiración lenta y profunda)','japanese':'呼吸。','acting':'calm','pauseBeforeFrames':24,'pauseAfterFrames':24}
        rows,minimum=voice_layout(s,[(vocal,{'samples':48000*20})])
        # Regla del usuario 2026-10-28: un sonido vocal que abre la toma
        # suena en el cambio de toma, no tras lead + pausa; por eso se
        # recorta solo por pausa posterior y acción final, no por lead.
        self.assertEqual(rows[0]['samples'],240*2000-24*2000-24*2000)
        self.assertEqual(minimum,240)
        spoken={**vocal,'spanish':'Sobrevivir.'}
        rows,minimum=voice_layout(s,[(spoken,{'samples':48000*20})])
        self.assertEqual(rows[0]['samples'],48000*20)
        self.assertGreater(minimum,240)

class VocalSubtitleTests(unittest.TestCase):
    def test_parenthetical_vocal_sound_is_recognised_as_not_dialogue(self):
        from shorts.core.timing import is_vocal_sound
        self.assertTrue(is_vocal_sound({'spanish':'(Respiración lenta y profunda)'}))
        self.assertFalse(is_vocal_sound({'spanish':'Sobrevivir.'}))
        self.assertFalse(is_vocal_sound({'spanish':'¿De dónde viene...?'}))
