"""Two text steps in a row complete: shared pacing outlives the lease window."""
import copy
import json
import sys
import unittest
from pathlib import Path
from unittest.mock import Mock,patch
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'worker/montage-shorts'))
from shorts.service.app import app
from shorts.service.config import config
from shorts.service.cloud import Cloud
from shorts.service.execution import execute_job
from test_job_recovery import DB

NOW=100_000.0
IDEAS=[{'id':'i%d'%n,'title':t,'premise':p} for n,(t,p) in enumerate([
 ('El último tren','Dos desconocidos comparten el último vagón y uno no piensa bajarse.'),
 ('La carta sin remitente','Una cajera recibe cada lunes una carta que describe su día siguiente.'),
 ('Treinta segundos','Un portero puede retroceder medio minuto, una sola vez al día.')],1)]
STAGE1={'title':'El último tren','story':'HISTORIA. '+('Aki sube al vagón y se sienta frente a un desconocido. ')*40,
        'beats':[{'id':'b%d'%k,'change':'Cambia algo %d'%k,'visible':'Se ve el andén %d'%k,'audible':'Se oye el motor %d'%k,
                  'intention':'Aki quiere quedarse','emotion':'tensión contenida',
                  'minFrames':1500,'preferredFrames':1800,'maxFrames':2100} for k in range(1,5)]}

def answered(data):
    return Mock(ok=True,status_code=200,headers={},json=lambda:{'candidates':[{'finishReason':'STOP','content':{'parts':[{'text':json.dumps(data,ensure_ascii=False)}]}}]})

class SessionContinuityTests(unittest.TestCase):
    def setUp(self):
        self.http=Mock()
        def post(url,json=None,timeout=None):
            if url.endswith(':countTokens'):return Mock(ok=True,status_code=200,headers={},json=lambda:{'totalTokens':120})
            text=(json.get('contents') or [{}])[0].get('parts',[{}])[0].get('text','')
            return answered(STAGE1 if 'Genera SOLO el paso Historia' in text else IDEAS)
        self.http.post.side_effect=post
        self.c=Cloud.__new__(Cloud)
        self.c.c={'project':'project','region':'region','queue':'queue','job':'worker','service':'https://service.run.app',
                  'serviceAccount':'sa@example.invalid','bucket':'bucket','models':config()['models']}
        self.c.http=self.http
        # The lease is alive when the step starts and runs out 10 s later: the
        # phone locked its screen, so its 10 s heartbeat stopped.
        self.c.db=DB({'animeShortsProjects/p':{'id':'p','owner':'u','revision':1,'genre':'drama','subgenres':[],'concept':'Un encuentro',
                                               'format':'16:9','selectedIdea':None,'lease':{'session':'s','device':'d','expires':NOW+10}},
                      # Another text job already reserved this minute of pacing.
                      'animeShortsCapacity/text-pacing':{'nextAt':NOW+60}})
        patcher=patch('google.cloud.firestore.transactional',side_effect=lambda fn:fn);patcher.start();self.addCleanup(patcher.stop)
        # One clock for everything, advanced by the waits instead of really sleeping.
        self.clock=[NOW]
        for target in ('shorts.service.cloud.time.time','shorts.service.app.time.time'):
            patcher=patch(target,side_effect=lambda:self.clock[0]);patcher.start();self.addCleanup(patcher.stop)
        patcher=patch('shorts.service.cloud.time.monotonic',side_effect=lambda:self.clock[0]);patcher.start();self.addCleanup(patcher.stop)
        patcher=patch('shorts.service.cloud.time.sleep',side_effect=lambda seconds:self.clock.__setitem__(0,self.clock[0]+seconds));patcher.start();self.addCleanup(patcher.stop)
        self.client=app.test_client()
    def seed_story_job(self):
        from shorts.core.contracts import digest
        self.c.db.data['animeShortsJobs/j']={'id':'j','projectId':'p','owner':'u','operation':'develop','state':'queued','session':'s','revision':1,
             'dispatchAttempt':0,'providerCalls':[],'payload':{'ideaId':'idea','stage':1,'sourceDraftId':None,'sourceHash':None,'instruction':''},
             'fingerprint':'f','inputRevision':1,'created':NOW}
        self.c.db.data['animeShortsProjects/p/ideas/idea']={'id':'idea','data':IDEAS[0]}
        self.c.db.data['animeShortsProjects/p']['selectedIdea']={'id':'idea','hash':digest(self.c.db.data['animeShortsProjects/p/ideas/idea'])}
    def run_job(self,jid):
        with patch('shorts.service.app.internal_identity',return_value=self.c.c),patch('shorts.service.app.cloud',return_value=self.c):
            return self.client.post('/internal/dispatch',json={'jobId':jid})
    def job(self,jid):return self.c.db.data['animeShortsJobs/'+jid]

    def test_the_story_is_written_although_the_pacing_wait_outlived_the_lease(self):
        self.seed_story_job()
        response=self.run_job('j')
        self.assertEqual(response.status_code,200,response.json)
        self.assertGreater(self.clock[0],NOW+10,'the wait really outlived the lease')
        settled=self.job('j')
        self.assertEqual(settled['state'],'awaiting_review',settled.get('result'))
        self.assertTrue(settled['settled'])
        draft=self.c.db.data['animeShortsProjects/p/developmentDrafts/j']
        self.assertEqual(draft['status'],'ready');self.assertEqual(draft['approvalState'],'candidate')
        self.assertGreater(len(draft['data']['story']),500)
        self.assertIsNone(self.c.db.data['animeShortsCapacity/text-analysis']['jobId'],'the engine is free again')

    def test_another_device_taking_the_lease_during_the_wait_does_stop_the_step(self):
        self.seed_story_job()
        # The owner opens the same project on another phone while this step waits.
        def takeover(seconds):
            self.clock[0]+=seconds
            self.c.db.data['animeShortsProjects/p']['lease']={'session':'otra','device':'otro','expires':self.clock[0]+3600}
        with patch('shorts.service.cloud.time.sleep',side_effect=takeover):
            self.run_job('j')
        settled=self.job('j')
        self.assertEqual(settled['state'],'failed')
        self.assertEqual(settled['result']['code'],'LEASE')
        self.assertIn('Otro dispositivo',settled['result']['error'])
        # The free token preflight may have run; no generation was paid for.
        self.assertFalse([c for c in self.http.post.call_args_list if 'generateContent' in c.args[0]])
        self.assertIsNone(self.c.db.data['animeShortsCapacity/text-analysis']['jobId'],'the engine is free again')

    def test_a_step_is_never_started_without_a_live_session(self):
        self.seed_story_job()
        self.c.db.data['animeShortsProjects/p']['lease']={'session':'s','device':'d','expires':NOW-1}
        self.assertEqual(self.run_job('j').json,{'dispatched':False})
        self.assertEqual(self.job('j')['state'],'queued')
        self.assertEqual(self.job('j')['dispatchError']['code'],'LEASE')
        self.http.post.assert_not_called()

if __name__=='__main__':unittest.main()
