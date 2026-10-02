"""Explicit deployment probe: one image and one voice, never a user project.

Only invoked by the authorized Cloud Shell updater in a separate Cloud Run Job.
The production Providers class is used unchanged. No retries or model fallback.
"""
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import time


def inspect_media(path, kind):
    result = subprocess.run(['ffprobe', '-v', 'error', '-show_streams', '-show_format',
                             '-of', 'json', str(path)], capture_output=True, text=True,
                            check=True, timeout=30)
    streams = json.loads(result.stdout).get('streams', [])
    stream = next((s for s in streams if s.get('codec_type') == kind), None)
    if not stream:
        raise ValueError('Missing decoded media stream')
    if kind == 'video' and (stream.get('width', 0) <= 0 or stream.get('height', 0) <= 0):
        raise ValueError('Invalid image dimensions')
    if kind == 'audio':
        duration = float(stream.get('duration') or json.loads(result.stdout).get('format', {}).get('duration') or 0)
        if int(stream.get('sample_rate', 0)) != 24000 or stream.get('channels') != 1 or duration <= 0:
            raise ValueError('Invalid or empty audio format')
    subprocess.run(['ffmpeg', '-v', 'error', '-xerror', '-i', str(path), '-f', 'null', '-'],
                   capture_output=True, check=True, timeout=30)
    return {k: stream[k] for k in ('codec_name', 'width', 'height', 'sample_rate', 'channels') if k in stream}


def verify(providers, save, inspect=inspect_media):
    """Return separate results, even when one provider fails. No second attempts."""
    from shorts.core.contracts import ContractError
    report = {'image': {'ok': False}, 'tts': {'ok': False}}
    with tempfile.TemporaryDirectory(prefix='shorts-probe-') as folder:
        for kind in ('image', 'tts'):
            try:
                if kind == 'image':
                    raw, mime = providers.image(
                        'Render one finished Japanese 2D anime reference image of a fully clothed '
                        'adult woman aged 28, wearing a navy jacket, standing in a quiet train '
                        'station at sunset. No text, captions, panels or logos. Return the actual image.',
                        [], '16:9')
                    name = 'reference-image'
                else:
                    raw = providers.tts({'japanese': 'こんにちは。今日はいい天気ですね。', 'acting': '穏やかに、自然な会話として。'},
                                        {'name': 'Kore', 'languageCode': 'ja-JP', 'direction': 'Natural Japanese speech.'})
                    mime, name = 'audio/wav', 'voice.wav'
                path = Path(folder) / name
                path.write_bytes(raw)
                media = inspect(path, 'video' if kind == 'image' else 'audio')
                obj = save(name, raw, mime)
                report[kind] = {'ok': True, 'bytes': len(raw), 'media': media, 'object': obj}
            except ContractError as error:
                report[kind] = {'ok': False, 'code': error.code, 'message': str(error)[:1000]}
            except Exception as error:
                # Never print SDK/transport exception strings, credentials or media.
                report[kind] = {'ok': False, 'code': type(error).__name__,
                                'message': 'No se pudo validar y guardar el archivo de prueba.'}
    report['ok'] = all(report[k]['ok'] for k in ('image', 'tts'))
    return report


def main():
    from google.api_core.exceptions import PreconditionFailed
    from shorts.service.config import config
    from shorts.service.cloud import Cloud
    from shorts.service.providers import Providers
    key = os.environ.get('SHORTS_RELEASE_PROBE', '')
    if not re.fullmatch(r'[a-f0-9]{32}', key):
        raise SystemExit('No explicit release probe ID. No generation submitted.')
    c = config()
    cloud = Cloud(c)
    prefix = 'installation/verification/' + key + '/'
    # An accidental repeat of this job cannot spend the same test twice.
    try:
        cloud.bucket.blob(prefix + 'started.json').upload_from_string(
            json.dumps({'commit': os.environ.get('SHORTS_BUILD_COMMIT'), 'started': time.time(),
                        'models': {k: c['models'][k] for k in ('image', 'tts')}}),
            content_type='application/json', if_generation_match=0)
    except PreconditionFailed:
        raise SystemExit('Probe already started. Read its saved report; it was not repeated.')
    def save(name, raw, mime):
        obj = prefix + name
        cloud.bucket.blob(obj).upload_from_string(raw, content_type=mime, if_generation_match=0)
        return obj
    report = verify(Providers(c, cloud.http), save)
    report.update(commit=os.environ.get('SHORTS_BUILD_COMMIT'), finished=time.time())
    save('report.json', json.dumps(report).encode(), 'application/json')
    print(json.dumps({k: report[k] for k in ('ok', 'commit')}), flush=True)
    raise SystemExit(0 if report['ok'] else 1)


if __name__ == '__main__':
    main()
