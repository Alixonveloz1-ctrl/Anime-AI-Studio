import copy
import unittest
from unittest.mock import Mock,patch
from shorts.core.contracts import ContractError,digest
from shorts.service.development import develop
from shorts.service.script_segments import segment_plan,continuation,checkpoint_hash
from test_manual_development import complete


class MemoryCloud:
    def __init__(self,story):
        self.rows={'story':{'id':'story','ideaId':'idea','stage':1,'status':'ready','approvalState':'approved','data':story}}
        self.db=Mock()
    def entity(self,pid,kind,key):return copy.deepcopy(self.rows[key])
    def put_entity(self,pid,kind,row):self.rows[row['id']]=copy.deepcopy(row)
    def entity_ref(self,pid,kind,key):
        ref=Mock();ref.update.side_effect=lambda value:self.rows[key].update(copy.deepcopy(value));return ref


class SegmentTests(unittest.TestCase):
    def setUp(self):
        self.raw=complete();self.story={k:self.raw[k] for k in ('title','story','beats')}
        self.c=MemoryCloud(self.story)
        self.p={'id':'p','owner':'u','genre':'drama','subgenres':[],'concept':'','format':'16:9','selectedIdea':{'id':'idea'},'activeDraft':'story'}
        self.idea={'id':'idea','data':{'title':'Idea','premise':'Decisión'}}
        self.provider=Mock();self.serial=0
    def run_part(self,part,checkpoint=None):
        self.serial+=1;jid='j'+str(self.serial)
        payload={'stage':2,'sourceDraftId':'story','sourceHash':digest(self.story)}
        if checkpoint:payload.update(checkpointId=checkpoint,checkpointHash=checkpoint_hash(self.c.rows[checkpoint]))
        self.provider.reset_mock();self.provider.text.side_effect=None;self.provider.text.return_value=part
        answer=develop(self.c,self.provider,{'id':jid,'payload':payload},self.p,self.idea)
        self.provider.text.assert_called_once()
        return self.c.rows[answer['draftId']]
    def part(self,segment,index):
        # Different shot lengths, all real-video requests <=8 s, with enough
        # coverage for the entire local budget. No stretching by the planner.
        remaining=segment['targetFrames'];shots=[];n=0
        while remaining:
            n+=1;frames=min(remaining,144 if n%2 else 192);remaining-=frames
            shot=copy.deepcopy(self.raw['shots'][0]);shot.update(id=f't{index}_s{n}',beatId=segment['beatId'],treatment='veo',frames=frames,minFrames=frames,maxFrames=frames,leadFrames=0,tailFrames=0)
            shots.append(shot)
        return {'shots':shots,'utterances':[]}
    def test_whole_story_checkpoints_cover_five_minutes_with_one_call_per_click(self):
        first=self.run_part({'bible':self.raw['bible']})
        self.assertEqual(first['status'],'partial');self.assertEqual(first['scriptProgress']['completed'],0)
        previous=first
        for i,segment in enumerate(first['segmentPlan']):
            snapshot=copy.deepcopy(previous)
            previous=self.run_part(self.part(segment,i),previous['id'])
            self.assertEqual(self.c.rows[snapshot['id']],snapshot)
            self.assertEqual(previous['scriptProgress']['completed'],i+1)
            if i+1<len(first['segmentPlan']):self.assertEqual(previous['status'],'partial')
        self.assertEqual(previous['status'],'ready')
        self.assertEqual(sum(s['frames'] for s in previous['data']['shots']),7200)
        self.assertTrue(all(s['frames']<=192 for s in previous['data']['shots']))
        self.assertEqual(previous['data']['story'],self.story['story'])
        self.assertEqual(self.p['activeDraft'],'story')
    def test_budget_covers_every_beat_and_splits_long_beats(self):
        for weights in ([7200],[10,20,10],[1,1,50,1]):
            prior=copy.deepcopy(self.story);base=prior['beats'][0]
            prior['beats']=[{**base,'id':f'b{i}','preferredFrames':w} for i,w in enumerate(weights)]
            plan=segment_plan(prior)
            self.assertEqual(sum(p['targetFrames'] for p in plan),7200)
            self.assertTrue(all(0<p['targetFrames']<=1152 for p in plan))
            self.assertEqual({p['beatId'] for p in plan},{b['id'] for b in prior['beats']})
            self.assertGreaterEqual(sum(p['minFrames'] for p in plan),6840)
            self.assertLessEqual(sum(p['maxFrames'] for p in plan),7560)
    def test_short_response_fails_only_current_segment_without_losing_previous(self):
        row=self.run_part({'bible':self.raw['bible']})
        row=self.run_part(self.part(row['segmentPlan'][0],0),row['id']);saved=copy.deepcopy(row)
        part=self.part(row['segmentPlan'][1],1);part['shots']=part['shots'][:1]
        with self.assertRaises(ContractError) as e:self.run_part(part,row['id'])
        self.assertEqual(e.exception.code,'SCRIPT_SEGMENT_DURATION')
        failed=self.c.rows['j3'];self.assertEqual(failed['data'],saved['data'])
        self.assertEqual(failed['checkpointId'],saved['id']);self.assertEqual(self.c.rows[saved['id']],saved)
        self.provider.text.assert_called_once()
        retry=self.run_part(self.part(row['segmentPlan'][1],1),row['id'])
        self.assertEqual(retry['scriptProgress']['completed'],2)
    def test_rate_limit_does_not_repeat_or_destroy_checkpoint(self):
        row=self.run_part({'bible':self.raw['bible']});saved=copy.deepcopy(row)
        self.provider.reset_mock();self.provider.text.side_effect=ContractError('PROVIDER_QUOTA','429')
        job={'id':'quota','payload':{'stage':2,'sourceDraftId':'story','sourceHash':digest(self.story),'checkpointId':row['id'],'checkpointHash':checkpoint_hash(row)}}
        with self.assertRaises(ContractError):develop(self.c,self.provider,job,self.p,self.idea)
        self.assertEqual(self.c.rows[row['id']],saved);self.assertEqual(self.c.rows['quota']['status'],'invalid');self.provider.text.assert_called_once()
    def test_checkpoint_rejects_other_story_and_changed_content_before_call(self):
        row=self.run_part({'bible':self.raw['bible']})
        for field,value in [('sourceDraftId','other'),('ideaId','other'),('status','invalid')]:
            modified=copy.deepcopy(row);modified[field]=value;self.c.rows[row['id']]=modified
            with self.assertRaises(ContractError):continuation(self.c,self.p,'story',self.story,row['id'])
        self.c.rows[row['id']]=row
        with self.assertRaises(ContractError):continuation(self.c,self.p,'story',self.story,row['id'],'changed')
    def test_repeated_identifiers_across_segments_are_not_accepted(self):
        row=self.run_part({'bible':self.raw['bible']});part=self.part(row['segmentPlan'][0],0)
        row=self.run_part(part,row['id'])
        with self.assertRaises(ContractError) as error:self.run_part(part,row['id'])
        self.assertEqual(error.exception.code,'DUPLICATE_ID')
    def test_api_pins_checkpoint_and_rejects_partial_final_approval(self):
        from shorts.service.app import app
        client=app.test_client();row=self.run_part({'bible':self.raw['bible']})
        c=Mock();c.entity.side_effect=lambda pid,kind,key:self.c.entity(pid,kind,key);c.submit.return_value={'id':'job','state':'queued'}
        with patch('shorts.service.app.owned',return_value={**self.p,'revision':1}),patch('shorts.service.app.cloud',return_value=c):
            response=client.post('/projects/p/develop',json={'stage':2,'sourceDraftId':'story','checkpointId':row['id'],'session':'s'},headers={'If-Match':'1','Idempotency-Key':'chunk'})
            self.assertEqual(response.status_code,202)
            payload=c.submit.call_args.args[2];self.assertEqual(payload['checkpointHash'],checkpoint_hash(row))
            c.entity_ref.return_value.get.return_value.to_dict.return_value=row
            c.mutate.side_effect=lambda pid,rev,change:change(Mock(),self.p)
            response=client.post('/projects/p/drafts/'+row['id']+':approve',json={},headers={'If-Match':'1'})
            self.assertEqual(response.status_code,409)

if __name__=='__main__':unittest.main()
