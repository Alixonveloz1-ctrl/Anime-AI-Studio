"""A variant image (layer_*, variantOf=a shot) is not a shot image.

Regression test for the Plano 09 selection bug: clicking "Usar esta
versión" on a variant only selected the layer, never the shot, so the
video kept using the old shot image and the tap looked like it did
nothing. The fix promotes the variant to a real shot image (entityId =
the shot, fingerprint of the current shot, no dependencies, because the
user chose it explicitly). That promoted copy must be selected for the
shot, while the raw variant must never be selected for the shot.
"""
import unittest

from shorts.core.dependencies import fingerprint, select_assets

DEVELOPMENT = {
    'bible': {
        'characters': [{'id': 'girl', 'name': 'Superviviente'}],
        'locations': [{'id': 'station', 'name': 'Estación'}],
        'props': [],
    },
    'shots': [{
        'id': 'shot09', 'prompt': 'Medium shot', 'locationId': 'station',
        'visibleCharacters': ['girl'], 'offscreenCharacters': [], 'props': [],
        'before': 'a', 'after': 'b', 'referenceEntityIds': ['station', 'girl'],
    }],
}


def asset(aid, entity_id, **extra):
    row = {'id': aid, 'entityId': entity_id, 'kind': 'image',
           'approvalState': 'approved', 'created': 1, **extra}
    return row


class VariantPromotionTest(unittest.TestCase):
    def test_variant_alone_is_not_selected_for_the_shot(self):
        variant = asset('v1', 'layer_1', variantOf='shot09',
                        inputFingerprint=None, dependencies=[])
        selected = select_assets([variant], DEVELOPMENT, 'dev',
                                 {'layer_1|image': 'v1'})
        self.assertNotIn(('shot09', 'image'), selected)

    def test_promoted_copy_is_selected_for_the_shot(self):
        old = asset('old', 'shot09',
                    inputFingerprint=fingerprint(DEVELOPMENT, 'shot09', 'image'),
                    dependencies=[], approvedAt=1)
        promoted = asset('new', 'shot09', promotedFrom='v1',
                         inputFingerprint=fingerprint(DEVELOPMENT, 'shot09', 'image'),
                         dependencies=[], approvedAt=2)
        selected = select_assets([old, promoted], DEVELOPMENT, 'dev',
                                 {'shot09|image': 'new'})
        self.assertEqual(selected[('shot09', 'image')]['id'], 'new')


if __name__ == '__main__':
    unittest.main()
