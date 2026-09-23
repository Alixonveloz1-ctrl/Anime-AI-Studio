"""Completeness/traceability gate, not a claim that acceptance tests passed."""
import json
from pathlib import Path
import re

ROOT=Path(__file__).resolve().parents[2]
rows=json.loads((ROOT/'docs/shorts/acceptance.json').read_text())
source=dict(re.findall(r'^(A\d{3}) · (.+)$',(ROOT/'docs/shorts/contract-v2.txt').read_text(),re.M))
assert len(rows)==100
assert {r['id'] for r in rows}=={f'A{n:03}' for n in range(1,101)}==set(source)
for row in rows:
    assert row['requirement']==source[row['id']],row['id']
    assert row['files'] and row['remaining'],row['id']
    for file in row['files']:
        assert (ROOT/file).is_file(),(row['id'],file)
    for test in row['tests']:
        file,_,symbol=test.partition(':')
        text=(ROOT/file).read_text()
        assert not symbol or 'def '+symbol+'(' in text,(row['id'],test)
    assert row['api'] in ('not_run','passed','failed')
    assert row['acceptance'] in ('pending','accepted')
print('100 requisitos contractuales trazados. Esta comprobación no los declara aceptados.')
