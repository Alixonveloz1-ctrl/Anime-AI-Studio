import copy
import unittest
from shorts.core.dependencies import fingerprint, select_assets, dependency_records


class DependencyTests(unittest.TestCase):
    def setUp(self):
        self.d = {'bible': {'characters': [{'id': 'c', 'referencePrompt': 'red coat', 'voice': {'name': 'Kore'}}], 'locations': [], 'props': []},
                  'shots': [{'id': 's', 'prompt': 'takes a book', 'frames': 48, 'before': {}, 'after': {}, 'referenceEntityIds': ['c']}],
                  'utterances': [{'id': 'u', 'japanese': '本です。', 'spanish': 'Es un libro.', 'acting': 'calm', 'speakerId': 'c'}], 'musicRequests': []}

    def asset(self, aid, eid, kind, dependencies=(), time=1):
        return dict(id=aid, entityId=eid, kind=kind, sha256='a'*64, approvalState='approved', created=time,
                    developmentId='old', inputFingerprint=fingerprint(self.d, eid, kind), dependencies=dependency_records(dependencies))

    def test_A009_A040_new_voice_preserves_visual_approvals(self):
        portrait=self.asset('portrait','c','image');shot=self.asset('shot','s','image',[portrait]);voice=self.asset('voice','u','pcm')
        original=copy.deepcopy([portrait,shot,voice]);d=copy.deepcopy(self.d);d['bible']['characters'][0]['voice']['name']='Puck'
        selected=select_assets(original,d,'new')
        self.assertEqual(selected[('s','image')]['id'],'shot');self.assertNotIn(('u','pcm'),selected)
        self.assertEqual(original,[portrait,shot,voice])

    def test_A025_costume_only_invalidates_dependents(self):
        portrait=self.asset('portrait','c','image');shot=self.asset('shot','s','image',[portrait]);voice=self.asset('voice','u','pcm')
        d=copy.deepcopy(self.d);d['bible']['characters'][0]['referencePrompt']='blue coat'
        selected=select_assets([portrait,shot,voice],d,'new')
        self.assertEqual(set(selected),{('u','pcm')})

    def test_A067_move_does_not_invalidate_image(self):
        shot=self.asset('shot','s','image');d=copy.deepcopy(self.d);d['shots'][0]['startFrame']=480;d['shots'][0]['frames']=240
        self.assertEqual(select_assets([shot],d,'new')[('s','image')]['id'],'shot')

    def test_A009_unapproved_replacement_keeps_approved_parent(self):
        portrait=self.asset('portrait','c','image');shot=self.asset('shot','s','image',[portrait]);candidate=self.asset('candidate','c','image',time=2);candidate['approvalState']='candidate'
        selected=select_assets([portrait,shot,candidate],self.d,'new')
        self.assertEqual(selected[('s','image')]['id'],'shot')

    def test_A029_new_master_invalidates_only_old_reference_uses(self):
        portrait=self.asset('portrait','c','image');shot=self.asset('shot','s','image',[portrait]);new=self.asset('new','c','image',time=2)
        selected=select_assets([portrait,shot,new],self.d,'new')
        self.assertEqual(selected[('c','image')]['id'],'new');self.assertNotIn(('s','image'),selected)

    def test_A017_translation_change_does_not_regenerate_japanese_voice(self):
        voice=self.asset('voice','u','pcm');d=copy.deepcopy(self.d);d['utterances'][0]['spanish']='Este es un libro.'
        self.assertIn(('u','pcm'),select_assets([voice],d,'new'))

    def test_A009_select_previous_approved_without_mutating_history(self):
        old=self.asset('old','c','image');new=self.asset('new','c','image',time=2)
        shot=self.asset('shot','s','image',[old]);original=copy.deepcopy([old,new,shot])
        selected=select_assets([old,new,shot],self.d,'dev',{'c|image':'old'})
        self.assertEqual(selected[('c','image')]['id'],'old');self.assertEqual(selected[('s','image')]['id'],'shot')
        self.assertEqual([old,new,shot],original)
        changed=copy.deepcopy(self.d);changed['bible']['characters'][0]['referencePrompt']='different'
        self.assertNotIn(('c','image'),select_assets([old,new,shot],changed,'dev',{'c|image':'old'}))
