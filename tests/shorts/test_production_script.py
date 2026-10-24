"""Correcting the production script by hand is never undone by reopening it."""
import copy
import sys
import unittest
from pathlib import Path
from unittest.mock import Mock,patch
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'worker/montage-shorts'))
from shorts.core.contracts import digest
from shorts.service.app import app
from shorts.service.cloud import Cloud
from test_job_recovery import DB
from test_manual_development import complete

NOW=50_000.0

class ProductionScriptTests(unittest.TestCase):
    def setUp(self):
        self.draft={'id':'d','ideaId':'idea','stage':3,'status':'ready','approvalState':'approved','data':complete()}
        self.c=Cloud.__new__(Cloud);self.c.c={'project':'project','region':'region'};self.c.http=Mock()
        self.c.db=DB({'animeShortsProjects/p':{'id':'p','owner':'u','revision':1,'activeDraft':'d',
                                               'selectedIdea':{'id':'idea'},'stage':'guion'},
                      'animeShortsProjects/p/developmentDrafts/d':self.draft})
        for target in ('google.cloud.firestore.transactional',):
            patcher=patch(target,side_effect=lambda fn:fn);patcher.start();self.addCleanup(patcher.stop)
        patcher=patch('shorts.service.app.time.time',return_value=NOW);patcher.start();self.addCleanup(patcher.stop)
        self.client=app.test_client()
    @property
    def project(self):return self.c.db.data['animeShortsProjects/p']
    def post(self,path,payload=None):
        with patch('shorts.service.app.cloud',return_value=self.c),patch('shorts.service.app.uid',return_value='u'):
            return self.client.post('/projects/p'+path,json=payload or {},headers={'If-Match':str(self.project['revision'])})
    def development(self,eid):return self.c.db.data['animeShortsProjects/p/developments/'+eid]

    def test_an_approved_correction_survives_pressing_use_this_script_again(self):
        opened=self.post('/drafts/d:produce')
        self.assertEqual(opened.status_code,200,opened.json)
        produced=self.project['activeDevelopment']
        # Reopening the untouched step is the same script: nothing to lose.
        self.assertEqual(self.post('/drafts/d:produce').status_code,200)
        self.assertEqual(self.project['activeDevelopment'],produced)
        # The owner corrects one shot of the production script and approves it.
        original=self.development(produced)['data']
        patches=[{'path':['shots',0,'prompt'],'value':'Otro encuadre del andén, más cerca.'}]
        preview=self.post(f'/developments/{produced}/edits:preview',{'sourceHash':digest(original),'patches':patches})
        self.assertEqual(preview.status_code,200,preview.json)
        saved=self.post(f'/developments/{produced}/edits:save',
                        {'sourceHash':digest(original),'patches':patches,'impactHash':preview.json['impactHash']})
        self.assertEqual(saved.status_code,201,saved.json)
        edited=saved.json['id']
        approved=self.post(f'/revisions/developments/{edited}:approve')
        self.assertEqual(approved.status_code,200,approved.json)
        self.assertEqual(self.project['activeDevelopment'],edited)
        # Pressing the button of the same approved step again must not rewind it.
        again=self.post('/drafts/d:produce')
        self.assertEqual(again.status_code,409,again.json)
        self.assertEqual(again.json['code'],'SCRIPT_EDITED')
        self.assertEqual(self.project['activeDevelopment'],edited,'the correction is still the production script')
        self.assertEqual(self.development(edited)['data']['shots'][0]['prompt'],'Otro encuadre del andén, más cerca.')

    def test_a_correction_is_refused_when_the_approved_step_changed_underneath(self):
        self.post('/drafts/d:produce')
        produced=self.project['activeDevelopment'];original=self.development(produced)['data']
        patches=[{'path':['title'],'value':'Otro título'}]
        preview=self.post(f'/developments/{produced}/edits:preview',{'sourceHash':digest(original),'patches':patches})
        saved=self.post(f'/developments/{produced}/edits:save',
                        {'sourceHash':digest(original),'patches':patches,'impactHash':preview.json['impactHash']})
        self.assertEqual(saved.status_code,201,saved.json)
        self.project['activeDraft']='otro'
        refused=self.post(f'/revisions/developments/{saved.json["id"]}:approve')
        self.assertEqual(refused.status_code,409,refused.json)
        self.assertEqual(refused.json['code'],'STAGE_CHANGED')

if __name__=='__main__':unittest.main()
