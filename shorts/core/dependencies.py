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


# Estados de un archivo generado que se puede usar. Regla del dueño: no se
# aprueba nada; lo más nuevo que se generó de cada cosa es lo que se usa.
USABLE = ('approved', 'candidate')


def momento(a):
    """Cuándo se eligió este archivo: al generarlo, o después si el dueño eligió
    expresamente una versión (promover una variante, «Usar esta versión»)."""
    return max(a.get('created') or 0, a.get('approvedAt') or 0, a.get('selectedAt') or 0)


def select_assets(assets, development, development_id, selections=None):
    """Lo más nuevo de cada cosa (imagen, video, voz, música), sin aprobar nada.

    Un archivo vale mientras corresponda al guion vigente (su huella) y los
    archivos de los que salió también correspondan al guion. Regenerar el
    retrato de un personaje no deja fuera las imágenes de toma hechas con el
    anterior: siguen siendo lo más nuevo de su toma hasta que se regeneren.
    Cambiar el guion de ese personaje sí las deja fuera, porque ya no lo
    muestran. Sin modificar nunca los registros históricos.
    """
    usable = [a for a in assets if a.get('approvalState') in USABLE and not a.get('requestId')]
    valid = {}
    for a in usable:
        expected = fingerprint(development, a.get('entityId'), a['kind'])
        ok = (a.get('inputFingerprint') == expected and expected is not None) if 'inputFingerprint' in a else a.get('developmentId') == development_id
        if ok:
            valid[a['id']] = a
    # Un derivado vale si cada archivo del que salió sigue valiendo.
    while True:
        caidos = [aid for aid, a in valid.items() if any(dep['assetId'] not in valid for dep in a.get('dependencies', []))]
        if not caidos:
            break
        for aid in caidos:
            del valid[aid]
    selected = {}
    for a in sorted(valid.values(), key=lambda a: (momento(a), a['id'])):
        selected[(a.get('entityId'), a['kind'])] = a
    return selected


def dependency_records(assets):
    return [{'entityId': a['entityId'], 'kind': a['kind'], 'assetId': a['id'], 'sha256': a['sha256']} for a in assets]
