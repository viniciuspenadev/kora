"""Real concurrent PostgreSQL checks. Creates a private, bounded Docker fixture; no production connection."""
import argparse
import concurrent.futures
import hashlib
import json
import pathlib
import subprocess
import time
import uuid

parser = argparse.ArgumentParser()
parser.add_argument('--migration', type=pathlib.Path, required=True)
parser.add_argument('--fixture', type=pathlib.Path, required=True)
args = parser.parse_args()
name = 'kora-voice-ownership-test-' + uuid.uuid4().hex[:12]
container_id = None

def command(*argv, input=None, check=True):
    return subprocess.run(argv, input=input, text=True, capture_output=True, check=check, timeout=40)

def sql(statement, role=None):
    prefix = 'SET ROLE ' + role + ';' if role else ''
    try:
        result = command('docker', 'exec', '-i', name, 'psql', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1',
                         '-U', 'postgres', '-d', 'voice_test', input=prefix + statement)
    except subprocess.CalledProcessError as error:
        raise RuntimeError('Fixture SQL rejected: ' + error.stderr.strip()) from None
    return result.stdout.strip()

def identifier(prefix, n):
    return f'{prefix}0000000-0000-0000-0000-{n:012}'

def claim(line=1, operator=1, tenant=1, attempt=None, session=None, token=None):
    attempt = attempt or str(uuid.uuid4())
    session = session or str(uuid.uuid4())
    token = token or hashlib.sha256(attempt.encode()).hexdigest()
    values = [identifier('1', tenant),identifier('2', line),identifier('3', line),identifier('4', operator),session,attempt,token,
              'https://fixture.example',f'fixture-line-{1 if line == 5 else line}']
    query = 'SELECT public.voice_claim_call(' + ','.join("'" + v + "'" for v in values) + ');'
    return json.loads(sql(query, 'service_role'))

def finish(attempt, fence=None):
    row = attempt['attempt']
    return json.loads(sql(f"SELECT public.voice_finish_reconciled_call('{row['id']}','{row['tenant_id']}',{fence or row['fence']},'cancelled','fixture-confirmed-idle');", 'service_role'))

def update(attempt, action, boot=None, call_id=None, state=None):
    row = attempt['attempt']
    values = [row['tenant_id'],row['operator_id'],row['browser_session_id'],row['id'],row['owner_token_hash'],
              row['fence'],action,boot,call_id,state]
    return json.loads(sql('SELECT public.voice_update_owned_call(' +
        ','.join('NULL' if v is None else "'" + str(v) + "'" for v in values) + ');','service_role'))

def cancel(attempt, session, operator=30, token=None):
    values = [attempt,identifier('1',1),identifier('3',1),identifier('4',operator),session,
              token or hashlib.sha256(attempt.encode()).hexdigest()]
    return json.loads(sql('SELECT public.voice_cancel_pending_claim(' +
        ','.join("'" + v + "'" for v in values) + ');','service_role'))

try:
    result = command('docker','run','--detach','--name',name,'--label','codex.voice-ownership-fixture=true',
                     '--network','none','--memory','256m','--pids-limit','128','--tmpfs','/var/lib/postgresql/data:rw,size=128m',
                     '--env','POSTGRES_HOST_AUTH_METHOD=trust','--env','POSTGRES_DB=voice_test','postgres:17',
                     '-c','shared_buffers=16MB','-c','max_connections=40','-c','fsync=off')
    container_id = result.stdout.strip()
    if len(container_id) != 64 or any(c not in '0123456789abcdef' for c in container_id):
        raise RuntimeError('unexpected disposable container identity')
    for _ in range(30):
        readiness=command('docker','exec',name,'psql','-X','-q','-A','-t','-U','postgres','-d','voice_test',
                          '-c','SHOW listen_addresses',check=False)
        if readiness.returncode == 0 and readiness.stdout.strip()=='*':
            break
        time.sleep(.3)
    else:
        raise RuntimeError('fixture did not start')
    sql(args.fixture.read_text(encoding='utf-8'))
    sql(args.migration.read_text(encoding='utf-8'))

    with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
        outcomes = list(pool.map(lambda n: claim(operator=n), range(1,21)))
    winners = [r for r in outcomes if r['ok']]
    assert len(winners) == 1 and all(r['ok'] or r['code']=='LINE_BUSY' for r in outcomes)
    assert finish(winners[0])['ok']
    print('PASS: 20 independent connections contest one line; exactly one owner', flush=True)

    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        outcomes = list(pool.map(lambda n: claim(line=n,operator=21), [1,2]))
    winners = [r for r in outcomes if r['ok']]
    assert len(winners)==1 and any(r.get('code')=='OPERATOR_BUSY' for r in outcomes)
    finish(winners[0])
    print('PASS: the same operator cannot reserve two lines in competing tabs', flush=True)

    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        a,b = list(pool.map(lambda x: claim(**x), [{'line':1,'operator':22,'tenant':1},{'line':3,'operator':23,'tenant':2}]))
    assert a['ok'] and b['ok']
    assert claim(line=1,operator=24,tenant=2)['code']=='NOT_ALLOWED'
    finish(a); finish(b)
    print('PASS: different tenants operate independently; foreign tenant claims are refused', flush=True)

    a=claim(operator=22)
    assert claim(line=3,tenant=2,operator=22)['code']=='OPERATOR_BUSY'
    assert claim(line=5,operator=23)['code']=='LINE_BUSY'
    finish(a)
    print('PASS: one global operator lease across companies; physical backend aliases cannot bypass line ownership', flush=True)

    attempt, session = str(uuid.uuid4()), str(uuid.uuid4())
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        repeated = list(pool.map(lambda _: claim(operator=25,attempt=attempt,session=session), range(8)))
    assert all(r['ok'] for r in repeated)
    assert len({r['attempt']['fence'] for r in repeated})==1
    assert sql(f"SELECT count(*) FROM public.voice_call_control_events WHERE attempt_id='{attempt}'")=='1'
    assert claim(operator=25,attempt=attempt,session=str(uuid.uuid4()))['code']=='INVALID_OWNER'
    finish(repeated[0])
    print('PASS: retries are idempotent; another browser session cannot claim the same attempt', flush=True)

    a=claim(operator=26)
    assert a['ok']
    sql(f"UPDATE public.voice_call_attempts SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id='{a['attempt']['id']}'")
    assert claim(operator=27)['code']=='RECOVERY_REQUIRED'
    assert finish(a, str(int(a['attempt']['fence'])+1))['code']=='STALE_FENCE'
    assert sql(f"SELECT finished_at IS NULL FROM public.voice_call_attempts WHERE id='{a['attempt']['id']}'")=='t'
    finish(a)
    successor=claim(operator=27)
    assert successor['ok'] and int(successor['attempt']['fence'])>int(a['attempt']['fence'])
    assert finish(a)['ok']
    assert sql(f"SELECT finished_at IS NULL FROM public.voice_call_attempts WHERE id='{successor['attempt']['id']}'")=='t'
    finish(successor)
    print('PASS: TTL alone does not free a line; stale cleanup cannot affect the successor', flush=True)

    assert claim(line=2,operator=41)['code']=='NOT_ALLOWED'
    a=claim(line=1,operator=41); assert a['ok']; finish(a)
    assert claim(line=4,operator=28)['code']=='NOT_ALLOWED'
    print('PASS: agent line grants are enforced and Meta Cloud lines are excluded', flush=True)

    sql("UPDATE public.fixture_modules SET enabled=NULL WHERE tenant_id='"+identifier('1',1)+"'")
    assert claim(operator=28)['code']=='NOT_ALLOWED'
    sql("UPDATE public.fixture_modules SET enabled=true")
    a=claim(operator=28); assert a['ok']
    boot=str(uuid.uuid4()); assert update(a,'confirm-backend',boot)['ok']
    sql("UPDATE public.tenant_users SET active=false WHERE user_id='"+identifier('4',28)+"'")
    assert update(a,'renew')['code']=='PERMISSION_REVOKED'
    assert sql(f"SELECT state FROM public.voice_call_attempts WHERE id='{a['attempt']['id']}'")=='recovering'
    assert finish(a)['ok']
    sql("UPDATE public.tenant_users SET active=true WHERE user_id='"+identifier('4',28)+"'")
    a=claim(operator=41); assert a['ok']
    sql("UPDATE public.tenant_users SET voice_instance_ids='{}' WHERE user_id='"+identifier('4',41)+"'")
    assert update(a,'dialing')['code']=='PERMISSION_REVOKED'
    finish(a)
    print('PASS: null/disabled modules fail closed; revoked membership and line grants stop renewal/dial while cleanup remains possible', flush=True)

    attempt,session=str(uuid.uuid4()),str(uuid.uuid4())
    assert cancel(attempt,session)['released']
    assert cancel(attempt,session)['released']
    assert cancel(attempt,str(uuid.uuid4()))['code']=='INVALID_OWNER'
    assert claim(operator=30,attempt=attempt,session=session)['code']=='ATTEMPT_CLOSED'
    a=claim(operator=30); row=a['attempt']
    assert cancel(row['id'],str(uuid.uuid4()))['code']=='INVALID_OWNER'
    assert cancel(row['id'],row['browser_session_id'])['released'] is False
    assert update(a,'renew')['code']=='RECOVERY_REQUIRED'
    finish(a)
    print('PASS: cancellation before a delayed claim prevents late admission; another tab cannot cancel the owner', flush=True)

    a=claim(operator=31); boot=str(uuid.uuid4()); assert update(a,'confirm-backend',boot)['ok']
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        outcomes=list(pool.map(lambda _: update(a,'dialing'),range(8)))
    assert sum(r['ok'] for r in outcomes)==1
    assert all(r['ok'] or r['code']=='DIAL_NOT_ALLOWED' for r in outcomes)
    assert update(a,'observe',boot,'fixture-call','connected')['ok']
    assert update(a,'observe',boot,'fixture-call','ringing')['attempt']['state']=='connected'
    assert update(a,'observe',boot,'fixture-call','ending')['ok']
    assert update(a,'observe',boot,'fixture-call','connected')['attempt']['state']=='ending'
    assert update(a,'observe',boot,'other-call','connected')['code']=='CALL_CHANGED'
    assert update(a,'observe',str(uuid.uuid4()),'fixture-call','ending')['code']=='BACKEND_CHANGED'
    finish(a)
    print('PASS: concurrent dial commands have one winner; late state events, call IDs and boot changes cannot revive or replace it', flush=True)

    claims=[claim(line=line,tenant=2 if line==3 else 1,operator=31+line) for line in [1,2,3]]
    sql("UPDATE public.voice_call_attempts SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE finished_at IS NULL")
    allowed="ARRAY['"+identifier('2',1)+"'::uuid,'"+identifier('2',2)+"'::uuid]"
    workers=[str(uuid.uuid4()),str(uuid.uuid4())]
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        batches=list(pool.map(lambda worker: json.loads(sql(f"SELECT public.voice_claim_recovery_batch('{worker}',{allowed},1)",'service_role')),workers))
    ids=[r['id'] for batch in batches for r in batch]
    assert len(ids)==2 and len(set(ids))==2
    assert sql(f"SELECT recovery_worker_id IS NULL FROM public.voice_call_attempts WHERE id='{claims[2]['attempt']['id']}'")=='t'
    selected=batches[0][0]
    before=sql(f"SELECT recovery_until FROM public.voice_call_attempts WHERE id='{selected['id']}'")
    sql(f"SELECT public.voice_defer_recovery('{selected['id']}','{selected['tenant_id']}',{selected['fence']},'{str(uuid.uuid4())}',5)",'service_role')
    assert sql(f"SELECT recovery_until FROM public.voice_call_attempts WHERE id='{selected['id']}'")==before
    assert json.loads(sql(f"SELECT public.voice_claim_recovery_batch('{str(uuid.uuid4())}',{allowed},4)",'service_role'))==[]
    for a in claims: finish(a)
    print('PASS: recovery workers claim disjoint bounded batches; excluded lines and stale worker deferrals remain untouched', flush=True)

    for _ in range(30):
        a=claim(operator=40); assert a['ok']; finish(a)
    assert claim(operator=40)['code']=='RATE_LIMITED'
    retained=None
    for _ in range(30):
        attempt,session=str(uuid.uuid4()),str(uuid.uuid4())
        assert cancel(attempt,session,operator=39)['released']
        retained=(attempt,session)
    assert cancel(*retained,operator=39)['released']
    assert cancel(str(uuid.uuid4()),str(uuid.uuid4()),operator=39)['code']=='RATE_LIMITED'
    print('PASS: new attempts and cancellation tombstones are rate bounded; idempotent cancellation survives the limit', flush=True)

    sql("SELECT setval('public.voice_call_fence_seq',9007199254740995)")
    a=claim(operator=29)
    assert a['attempt']['fence']=='9007199254740996'
    finish(a)
    print('PASS: fencing numbers are returned as exact strings beyond JS safe integers', flush=True)

    signature='public.voice_claim_call(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text)'
    for role in ['anon','authenticated']:
        assert sql(f"SELECT has_function_privilege('{role}','{signature}','EXECUTE')")=='f'
        assert sql(f"SELECT has_table_privilege('{role}','public.voice_call_attempts','SELECT')")=='f'
    assert sql("SELECT has_table_privilege('service_role','public.voice_call_attempts','UPDATE')")=='f'
    assert sql("SELECT relrowsecurity FROM pg_class WHERE oid='public.voice_call_attempts'::regclass")=='t'
    print('PASS: RLS enabled; browser roles denied; service writes are restricted to RPCs', flush=True)
finally:
    if container_id:
        inspection=command('docker','inspect',container_id,'--format','{{ index .Config.Labels "codex.voice-ownership-fixture" }}',check=False)
        if inspection.returncode==0 and inspection.stdout.strip()=='true':
            command('docker','rm','--force',container_id)
            print('Disposable PostgreSQL fixture removed; no exposed port or persistent volume', flush=True)
