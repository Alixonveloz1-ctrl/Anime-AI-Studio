"""Content-addressed dependencies; approved versions themselves never become stale.

Validity belongs to a use in an edit. A new script can reuse unaffected approvals.
"""
from .contracts import digest


def resource_input(development, entity_id, kind):
    bible = development['bible']
    entities = {e['id']: e for group in ('characters', 'locations', 'props') for e in bible[group]}
    shots = {s['id']: s for s in development['shots']}
    if kind == 'image':
        if entity_id in shots:
            s = shots[entity_id]
            # Timing and voice corrections do not alter a storyboard illustration.
            fields = ('prompt', 'locationId', 'visibleCharacters', 'offscreenCharacters', 'props', 'before', 'after', 'referenceEntityIds')
            return {k: s.get(k) for k in fields}
        e = entities.get(entity_id)
        if e:
            return {k: v for k, v in e.items() if k not in ('voice', 'speech', 'japaneseReading')}
    if kind == 'veo_silent_validated' and entity_id in shots:
        s = shots[entity_id]
        return {k: s.get(k) for k in ('prompt', 'before', 'after', 'referenceEntityIds', 'continuousActionApproved')}
    if kind == 'pcm':
        u = next((u for u in development['utterances'] if u['id'] == entity_id), None)
        if u:
            e = entities.get(u['speakerId'], {})
            return {'japanese': u['japanese'], 'acting': u.get('acting'), 'speakerId': u['speakerId'],
                    'voice': e.get('voice'), 'reading': e.get('japaneseReading')}
        r = next((r for r in development['musicRequests'] if r['id'] == entity_id), None)
        if r:
            return {k: r.get(k) for k in ('prompt', 'seconds')}
    return None


def fingerprint(development, entity_id, kind):
    value = resource_input(development, entity_id, kind)
    return digest(value) if value is not None else None


def select_assets(assets, development, development_id):
    """Select current approved inputs first, then derivatives referencing those IDs.

    No mutation of historic records, no blanket invalidation on development ID.
    External uploads are associated with an explicit sound request separately.
    """
    selected = {}
    candidates = sorted((a for a in assets if a.get('approvalState') == 'approved'),
                        key=lambda a: (a.get('approvedAt', a.get('created', 0)), a['id']))
    remaining = candidates[:]
    for _ in range(len(candidates) + 1):
        progressed = False
        for a in remaining[:]:
            eid, kind = a.get('entityId'), a['kind']
            expected = fingerprint(development, eid, kind)
            if a.get('requestId'):
                remaining.remove(a)
                continue
            valid = (a.get('inputFingerprint') == expected and expected is not None) if 'inputFingerprint' in a else a.get('developmentId') == development_id
            if not valid:
                remaining.remove(a)
                continue
            deps = a.get('dependencies', [])
            if any(selected.get((dep['entityId'], dep['kind']), {}).get('id') != dep['assetId'] for dep in deps):
                continue
            selected[(eid, kind)] = a
            remaining.remove(a)
            progressed = True
        if not progressed:
            break
    # An earlier derivative may have been selected before a newer parent.
    while True:
        invalid = [key for key, a in selected.items() if any(
            selected.get((dep['entityId'], dep['kind']), {}).get('id') != dep['assetId']
            for dep in a.get('dependencies', []))]
        if not invalid:
            return selected
        for key in invalid:
            del selected[key]


def dependency_records(assets):
    return [{'entityId': a['entityId'], 'kind': a['kind'], 'assetId': a['id'], 'sha256': a['sha256']} for a in assets]
