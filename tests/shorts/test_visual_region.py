"""A localized region that ends at the edge of the image is inside the image."""
import sys
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'worker/montage-shorts'))
from shorts.core.contracts import ContractError
from shorts.core.visual import validate_visual

APPROVED={'variante':{'approvalState':'approved','variantOf':'s'}}

def shot(mask):
    return {'id':'s','frames':48,'treatment':'localized',
            'layers':[{'assetRevision':'variante','approved':True,'mask':mask,'startFrame':0,'endFrame':48}]}

class VisualRegionTests(unittest.TestCase):
    def test_a_region_reaching_the_right_or_bottom_edge_is_accepted(self):
        # The studio sends hundredths. Every band that ends exactly at the edge
        # fits; one in five was refused for the last bit of a float.
        refused=[]
        for n in range(100):
            for mask in ({'x':n/100,'y':0,'width':(100-n)/100,'height':1},
                         {'x':0,'y':n/100,'width':1,'height':(100-n)/100}):
                try:validate_visual(shot(mask),APPROVED)
                except ContractError:refused.append(mask)
        self.assertEqual(refused,[])

    def test_a_region_that_leaves_the_image_is_still_refused(self):
        for mask in ({'x':.5,'y':0,'width':.51,'height':1},{'x':0,'y':.5,'width':1,'height':.51},
                     {'x':1,'y':0,'width':.1,'height':.1},{'x':0,'y':0,'width':0,'height':.5},
                     {'x':-.1,'y':0,'width':.5,'height':.5}):
            with self.subTest(mask=mask),self.assertRaises(ContractError):validate_visual(shot(mask),APPROVED)

    def test_an_accepted_region_never_reaches_the_montage_past_the_edge(self):
        for mask in ({'x':.33,'y':.67,'width':.67,'height':.33},{'x':.07,'y':.78,'width':.93,'height':.22}):
            checked=validate_visual(shot(dict(mask)),APPROVED)['layers'][0]['mask']
            self.assertLessEqual(checked['x']+checked['width'],1)
            self.assertLessEqual(checked['y']+checked['height'],1)

if __name__=='__main__':unittest.main()
