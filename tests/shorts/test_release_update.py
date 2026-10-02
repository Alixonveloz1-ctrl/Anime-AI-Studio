import copy
import importlib.util
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'infra' / 'shorts'))
spec = importlib.util.spec_from_file_location('shorts_existing_update', ROOT / 'infra' / 'shorts' / 'update_existing.py')
updater = importlib.util.module_from_spec(spec); spec.loader.exec_module(updater)
SHA = 'b' * 40


def fixture():
    project = 'test-project'
    prefix = updater.PREFIX
    state = {'project': project, 'region': 'us-central1', 'service': prefix,
             'bucket': project + '-' + prefix, 'commit': 'a' * 40, 'revision': 'original',
             'url': 'https://existing.run.app', 'job': prefix + '-old', 'auth': 'ready', 'vercel': 'ready'}
    env = {'SHORTS_GCP_PROJECT_ID': project, 'SHORTS_GCS_BUCKET': state['bucket'], 'SHORTS_GCS_PREFIX': prefix,
           'SHORTS_FIRESTORE_DATABASE': prefix, 'SHORTS_ENVIRONMENT': 'production',
           'SHORTS_ALLOWED_EMAILS': 'owner@example.com', 'SHORTS_SERVICE_ACCOUNT': 'runtime@example.com',
           'SHORTS_RENDER_JOB': state['job'], 'SHORTS_PRODUCTION_URL': state['url'], 'PRESERVE_SETTING': 'retained'}
    service = {'metadata': {'labels': {'managed-by': 'anime-shorts-v2'}},
               'status': {'url': state['url'], 'traffic': [{'revisionName': 'original', 'percent': 100}]},
               'spec': {'template': {'spec': {'serviceAccountName': 'runtime@example.com', 'containers': [
                   {'command': ['gunicorn'], 'args': ['--bind', ':8080', 'shorts.service.app:app'],
                    'env': [{'name': k, 'value': v} for k, v in env.items()]}]}}}}
    return project, state, service


class ExistingReleaseTests(unittest.TestCase):
    def test_validates_original_identity_resources_and_retains_environment(self):
        project, old, live = fixture()
        env = updater.validate_existing(project, 'owner@example.com', old, live)
        self.assertEqual(env['PRESERVE_SETTING'], 'retained')
        self.assertEqual(updater.active_revisions(live), {'original': 100})

    def test_foreign_resources_owner_secret_and_concurrent_traffic_fail_closed(self):
        for change in ('owner', 'bucket', 'label', 'traffic', 'secret', 'command'):
            project, old, live = fixture(); account = 'owner@example.com'
            if change == 'owner': account = 'someone@example.com'
            if change == 'bucket': old['bucket'] = 'another-project'
            if change == 'label': live['metadata']['labels'] = {}
            if change == 'traffic': live['status']['traffic'][0]['revisionName'] = 'other'
            if change == 'secret': live['spec']['template']['spec']['containers'][0]['env'].append({'name': 'SECRET', 'valueFrom': {}})
            if change == 'command': live['spec']['template']['spec']['containers'][0]['command'] = ['other']
            with self.subTest(change=change), self.assertRaises(RuntimeError):
                updater.validate_existing(project, account, old, live)

    def exercise(self, *, approved=True, image=True, voice=True, public_sha=SHA, stale_template=False):
        project, old, live = fixture(); calls = []; envs = []; saved = []; tag = None
        serving = copy.deepcopy(live['spec']['template']['spec'])
        if stale_template:
            live['spec']['template']['spec']['containers'][0]['env'] = [{'name': 'WRONG', 'value': 'failed-old-candidate'}]
        report = {'commit': SHA, 'ok': image and voice, 'image': {'ok': image}, 'tts': {'ok': voice}}
        def google(*args, **kwargs):
            nonlocal tag
            calls.append(args)
            if args[:2] == ('auth', 'list'): return 'owner@example.com'
            if args[:3] == ('run', 'services', 'describe'): return json.dumps(live)
            if args[:3] == ('run', 'revisions', 'describe'): return json.dumps({'spec': serving})
            if args[:4] == ('artifacts', 'docker', 'images', 'describe'): return 'sha256:' + 'c' * 64
            if args[:3] == ('run', 'jobs', 'deploy'):
                envs.append((args[3], json.loads(Path(args[args.index('--env-vars-file')+1]).read_text()), args))
            if args[:2] == ('run', 'deploy'):
                tag = args[args.index('--tag')+1]
                live['status']['latestReadyRevisionName'] = 'candidate'
                live['status']['traffic'].append({'tag': tag, 'url': 'https://candidate.run.app', 'revisionName': 'candidate', 'percent': 0})
            if args[:2] == ('storage', 'cat'): return json.dumps(report)
            if args[:3] == ('run', 'services', 'update-traffic'):
                revision = args[args.index('--to-revisions')+1].split('=')[0]
                live['status']['traffic'] = [{'revisionName': revision, 'percent': 100}]
            return ''
        def state_save(bucket, state, folder): saved.append(copy.deepcopy(state))
        with patch.object(updater, 'current_release', return_value=SHA), patch.object(updater, 'g', side_effect=google), \
             patch.object(updater, 'command'), patch.object(updater, 'check_owned', return_value=True), \
             patch.object(updater, 'state_load', return_value=copy.deepcopy(old)), \
             patch.object(updater, 'health', return_value=True), patch.object(updater, 'read_site', return_value={'commit': public_sha}), \
             patch.object(updater, 'state_save', side_effect=state_save), patch('builtins.input', return_value='ACTUALIZAR' if approved else ''), patch('builtins.print'):
            error = None
            try: updater.update(project)
            except RuntimeError as e: error = e
        return calls, envs, saved, error, live

    def test_cancel_stops_before_all_cloud_writes_and_paid_probes(self):
        calls, _, saved, error, _ = self.exercise(approved=False)
        self.assertIsNone(error); self.assertFalse(saved)
        self.assertTrue(all(c[:2] == ('auth', 'list') or c[:3] in (('run', 'services', 'describe'), ('run', 'revisions', 'describe')) for c in calls))

    def test_update_verifies_both_files_before_activating_same_digest_without_iam_or_vercel(self):
        calls, envs, saved, error, _ = self.exercise()
        self.assertIsNone(error); self.assertEqual(len(saved), 1)
        self.assertEqual(saved[0]['mediaVerification']['commit'], SHA)
        executions = [c for c in calls if c[:3] == ('run', 'jobs', 'execute')]
        self.assertEqual(len(executions), 2)
        self.assertTrue(all(c[0] not in ('iam', 'projects', 'services') for c in calls))
        self.assertEqual(envs[0][1]['PRESERVE_SETTING'], 'retained')
        self.assertNotIn('SHORTS_RELEASE_PROBE', envs[0][1])
        self.assertIn('SHORTS_RELEASE_PROBE', envs[1][1])
        self.assertIn('--max-retries=0', envs[1][2])
        traffic_index = next(i for i,c in enumerate(calls) if c[:3] == ('run', 'services', 'update-traffic'))
        report_index = next(i for i,c in enumerate(calls) if c[:2] == ('storage', 'cat'))
        self.assertLess(report_index, traffic_index)

    def test_a_prior_failed_candidate_cannot_supply_the_active_runtime_configuration(self):
        calls, envs, saved, error, _ = self.exercise(stale_template=True)
        self.assertIsNone(error); self.assertEqual(envs[0][1]['PRESERVE_SETTING'], 'retained')
        self.assertNotIn('WRONG', envs[0][1]); self.assertEqual(len(saved), 1)

    def test_either_failed_media_probe_prevents_activation_and_does_not_repeat(self):
        for image, voice in ((False, True), (True, False)):
            calls, _, saved, error, _ = self.exercise(image=image, voice=voice)
            self.assertIsNotNone(error); self.assertFalse(saved)
            self.assertFalse(any(c[:3] == ('run', 'services', 'update-traffic') for c in calls))
            self.assertEqual(sum(c[:3] == ('run', 'jobs', 'execute') for c in calls), 2)

    def test_wrong_public_backend_rolls_back_only_our_candidate_and_does_not_claim_success(self):
        calls, _, saved, error, live = self.exercise(public_sha='different')
        self.assertIsNotNone(error); self.assertFalse(saved)
        self.assertEqual(updater.active_revisions(live), {'original': 100})
        self.assertEqual(sum(c[:3] == ('run', 'services', 'update-traffic') for c in calls), 2)


if __name__ == '__main__': unittest.main()
