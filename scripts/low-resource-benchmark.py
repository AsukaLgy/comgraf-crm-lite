#!/usr/bin/env python3
"""Controlled Comgraf smoke/load/idle test; records latency and bounded host/container metrics."""
import argparse
import concurrent.futures
import http.cookiejar
import json
import math
import os
from pathlib import Path
import random
import ssl
import re
import statistics
import subprocess
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import date, timedelta

HEADERS = {'X-Comgraf-Request': '1', 'X-Comgraf-Contract': '4', 'X-Comgraf-Build': 'lan-light'}
TLS_CONTEXT = ssl.create_default_context()


def percentile(values, fraction):
    if not values:
        return None
    ordered = sorted(values)
    return round(ordered[min(len(ordered) - 1, math.ceil(fraction * len(ordered)) - 1)] * 1000, 1)


class Client:
    def __init__(self, base):
        self.base = base.rstrip('/')
        self.cookies = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.cookies),
                                                 urllib.request.HTTPSHandler(context=TLS_CONTEXT))
        self.durations = {}
        self.errors = []

    def request(self, label, path, *, method='GET', body=None, expected=(200,)):
        data = json.dumps(body).encode() if body is not None else None
        headers = dict(HEADERS)
        if data is not None:
            headers['Content-Type'] = 'application/json'
        request = urllib.request.Request(self.base + path, data=data, headers=headers, method=method)
        started = time.monotonic()
        try:
            with self.opener.open(request, timeout=10) as response:
                payload = response.read()
                code = response.status
            elapsed = time.monotonic() - started
            self.durations.setdefault(label, []).append(elapsed)
            if code not in expected:
                self.errors.append({'action': label, 'status': code})
                raise RuntimeError(f'{label} returned HTTP {code}')
            if payload:
                try:
                    return json.loads(payload)
                except (json.JSONDecodeError, UnicodeDecodeError):
                    return payload
            return None
        except urllib.error.HTTPError as error:
            self.durations.setdefault(label, []).append(time.monotonic() - started)
            self.errors.append({'action': label, 'status': error.code})
            raise RuntimeError(f'{label} returned HTTP {error.code}') from None
        except Exception as error:
            self.durations.setdefault(label, []).append(time.monotonic() - started)
            self.errors.append({'action': label, 'error': type(error).__name__})
            raise

    def login(self, username, password):
        self.request('login', '/api/auth/login', method='POST', body={'username': username, 'password': password})


def wait_for_ready(base, timeout=90):
    started = time.monotonic()
    deadline = started + timeout
    last_error = 'not_ready'
    request = urllib.request.Request(base.rstrip('/') + '/api/health', headers=HEADERS)
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(request, context=TLS_CONTEXT, timeout=3) as response:
                payload = json.loads(response.read())
                if response.status == 200 and payload.get('status') == 'ok':
                    return round((time.monotonic() - started) * 1000, 1)
                last_error = 'health_not_ok'
        except Exception as error:
            last_error = type(error).__name__
        time.sleep(0.5)
    raise RuntimeError(f'Comgraf API did not become healthy within {timeout}s ({last_error})')


def functional_smoke(base, credential_file):
    data = json.loads(Path(credential_file).read_text(encoding='utf-8'))
    if data.get('environment') != 'test-only' or not data.get('users'):
        raise SystemExit('Credential file is not marked test-only.')
    user = data['users'][0]
    client = Client(base)
    html = client.request('web_home', '/')
    if not isinstance(html, bytes) or b'<div id="root"' not in html:
        raise RuntimeError('React entry page was not served')
    asset_match = re.search(rb'(?:src|href)="(/assets/[^\"]+)', html)
    if not asset_match:
        raise RuntimeError('Compiled React asset was not referenced from the page')
    client.request('web_static_asset', asset_match.group(1).decode('ascii'))
    client.login(user['username'], user['password'])
    client.request('auth_me', '/api/auth/me')
    customer = client.request('create_client', '/api/clients', method='POST', expected=(201,),
                              body={'name': 'DEMO · LAN ligero cliente funcional', 'company': 'DEMO · Imprenta de prueba',
                                    'phones': [], 'emails': []})
    case = client.request('create_case', '/api/cases', method='POST', expected=(201,),
                          body={'client_id': customer['id'], 'subject': 'DEMO · prueba funcional LAN ligero'})
    current = client.request('case_before_take', f"/api/cases/{case['id']}")
    current = client.request('take_case', f"/api/cases/{case['id']}/take", method='POST',
                             body={'version': current['version'], 'key': uuid.uuid4().hex})
    note = {'version': current['version'], 'key': uuid.uuid4().hex, 'kind': 'Nota interna',
            'channel': 'Nota', 'direction': 'Interna', 'body': 'DEMO · nota funcional LAN ligero'}
    current = client.request('add_note', f"/api/cases/{case['id']}/events", method='POST', body=note)
    cai = {'product': 'Talonarios de factura CAI', 'quantity': '2', 'unit': 'talonarios', 'unit_price': '125.00',
           'specs': {'cai_format': 'Media carta', 'games_per_pad': 25, 'paper_type': 'Bond',
                     'additional_copies': 1, 'cai_binding': 'Engrapado'}}
    conversion = {'version': current['version'], 'key': uuid.uuid4().hex, 'items': [cai], 'currency': 'HNL',
                  'payment_terms': 'Contado', 'advance_required': '0.00',
                  'payment_due_date': (date.today() + timedelta(days=14)).isoformat(),
                  'delivery_method': 'Retiro · prueba LAN'}
    current = client.request('create_cai_order', f"/api/cases/{case['id']}/convert", method='POST', body=conversion)
    order = current['production']
    if order['stage'] != 'APPROVAL':
        raise RuntimeError('Nueva orden CAI no quedó en Aprobación')
    stage_body = {'version': current['version'], 'key': uuid.uuid4().hex,
                  'production_id': order['id'], 'stage': 'PRINTING'}
    client.request('advance_stage', f"/api/cases/{case['id']}/production/stage", method='POST', body=stage_body)
    client.request('calendar', '/api/calendar')
    boundary = '----ComgrafTest' + uuid.uuid4().hex
    payload = b'DEMO adjunto de prueba LAN\n'
    multipart = (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="lan-test.txt"\r\n'
                 f'Content-Type: text/plain; charset=utf-8\r\n\r\n').encode() + payload + f'\r\n--{boundary}--\r\n'.encode()
    request = urllib.request.Request(base.rstrip('/') + f"/api/cases/{case['id']}/attachments", data=multipart,
        headers={**HEADERS, 'Content-Type': f'multipart/form-data; boundary={boundary}'}, method='POST')
    started = time.monotonic()
    with client.opener.open(request, timeout=10) as response:
        attachment = json.loads(response.read())
        client.durations.setdefault('upload_test_attachment', []).append(time.monotonic() - started)
        if response.status != 201:
            raise RuntimeError('Attachment upload failed')
    downloaded = client.request('download_test_attachment', f"/api/attachments/{attachment['id']}")
    if payload not in downloaded:
        raise RuntimeError('Downloaded test attachment differs')
    client.request('search_clients', '/api/clients?q=DEMO')
    client.request('case_inbox', '/api/cases?view=mine')
    client.request('counts', '/api/counts')
    return {'case_id': case['id'], 'production_id': order['id'], 'attachment_id': attachment['id'],
            'http_actions': {key: len(value) for key, value in client.durations.items()},
            'latency_ms': {key: {'p50': percentile(value, .5), 'p95': percentile(value, .95)}
                           for key, value in client.durations.items()},
            'errors': client.errors}


def bytes_value(value):
    match = re.match(r'([0-9.]+)([KMG]i?B)?', value.strip())
    if not match:
        return None
    amount, unit = match.groups()
    multiplier = {'KB': 1000, 'KiB': 1024, 'MB': 1000**2, 'MiB': 1024**2,
                  'GB': 1000**3, 'GiB': 1024**3}.get(unit, 1)
    return int(float(amount) * multiplier)


def collect_container_stats(names):
    if not names:
        return {}
    try:
        result = subprocess.run(['docker', 'stats', '--no-stream', '--format', '{{json .}}', *names],
                                capture_output=True, text=True, timeout=8)
    except (OSError, subprocess.TimeoutExpired):
        return {}
    values = {}
    if result.returncode:
        return values
    for line in result.stdout.splitlines():
        try:
            row = json.loads(line)
            name = row.get('Name')
            values[name] = {'cpu_percent': row.get('CPUPerc'), 'memory_usage': row.get('MemUsage'),
                            'memory_limit': row.get('MemUsage', '').split('/')[-1].strip(),
                            'block_io': row.get('BlockIO')}
        except json.JSONDecodeError:
            continue
    return values


def docker_project_containers():
    result = subprocess.run(['docker', 'ps', '--filter', 'label=com.docker.compose.project=comgraf-lan-light',
                             '--format', '{{.Names}}'], capture_output=True, text=True)
    return result.stdout.splitlines() if result.returncode == 0 else []


def host_metrics():
    metrics = {'load_average': os.getloadavg() if hasattr(os, 'getloadavg') else None}
    try:
        memory = {}
        for line in Path('/proc/meminfo').read_text().splitlines():
            key, rest = line.split(':', 1)
            if key in {'MemAvailable', 'SwapTotal', 'SwapFree'}:
                memory[key] = int(rest.strip().split()[0]) * 1024
        vm = {}
        for line in Path('/proc/vmstat').read_text().splitlines():
            key, value = line.split()
            if key in {'oom_kill', 'pswpin', 'pswpout', 'pgmajfault'}:
                vm[key] = int(value)
        metrics.update({'host_memory_bytes': memory, 'host_vm_counters': vm})
    except (OSError, ValueError):
        pass
    return metrics


def sample_summary(samples):
    summary = {'container_peaks': {}, 'mysql_status_delta': {}, 'mysql_disk_delta': {},
               'host_mem_available_min_bytes': None, 'host_vm_counter_delta': {}}
    for sample in samples:
        for name, container in sample.get('containers', {}).items():
            peak = summary['container_peaks'].setdefault(name, {'cpu_percent_max': 0.0, 'memory_bytes_max': 0})
            try:
                peak['cpu_percent_max'] = max(peak['cpu_percent_max'], float(container.get('cpu_percent', '').rstrip('%')))
            except ValueError:
                pass
            used = container.get('memory_usage', '').split('/', 1)[0]
            amount = bytes_value(used)
            if amount is not None:
                peak['memory_bytes_max'] = max(peak['memory_bytes_max'], amount)
        available = sample.get('host_memory_bytes', {}).get('MemAvailable')
        if available is not None and (summary['host_mem_available_min_bytes'] is None or available < summary['host_mem_available_min_bytes']):
            summary['host_mem_available_min_bytes'] = available
    for key, destination in (('mysql_status', 'mysql_status_delta'), ('mysql_disk', 'mysql_disk_delta')):
        before = next((sample.get(key) for sample in samples if sample.get(key)), None)
        after = next((sample.get(key) for sample in reversed(samples) if sample.get(key)), None)
        if before and after:
            for name, value in after.items():
                if name in before and isinstance(value, int) and isinstance(before[name], int):
                    summary[destination][name] = value - before[name]
    if samples:
        first = samples[0].get('host_vm_counters', {})
        last = samples[-1].get('host_vm_counters', {})
        summary['host_vm_counter_delta'] = {name: last[name] - first[name] for name in last if name in first}
    return summary


def disk_counters(path):
    if not path:
        return None
    try:
        stat = Path(path).stat()
        major, minor = os.major(stat.st_dev), os.minor(stat.st_dev)
        for line in Path('/proc/diskstats').read_text().splitlines():
            fields = line.split()
            if len(fields) >= 14 and int(fields[0]) == major and int(fields[1]) == minor:
                return {'device': fields[2], 'read_ios': int(fields[3]), 'sectors_read': int(fields[5]),
                        'write_ios': int(fields[7]), 'sectors_written': int(fields[9]),
                        'io_ms': int(fields[12])}
    except (OSError, ValueError, IndexError):
        return None
    return None


def mysql_status():
    command = ['docker', 'exec', 'comgraf-lan-light-db-1', 'sh', '-c',
               'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql --protocol=socket --socket=/run/mysqld/mysql.sock -uroot -N -B -e '
               '"SHOW GLOBAL STATUS WHERE Variable_name IN (\'Threads_connected\',\'Threads_running\',\'Connections\',\'Slow_queries\',\'Questions\',\'Innodb_buffer_pool_reads\',\'Innodb_buffer_pool_read_requests\')"']
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=5)
    except (OSError, subprocess.TimeoutExpired):
        return None
    if result.returncode:
        return None
    values = {}
    for line in result.stdout.splitlines():
        fields = line.split('\t')
        if len(fields) == 2:
            try:
                values[fields[0]] = int(fields[1])
            except ValueError:
                continue
    return values


def load_user(base, user, duration, stop, shared):
    client = Client(base)
    try:
        client.login(user['username'], user['password'])
        shared['logins'] += 1
        while not stop.is_set() and time.monotonic() < shared['deadline']:
            for label, path in [('counts', '/api/counts'), ('my_cases', '/api/cases?view=mine'),
                                ('client_search', '/api/clients?q=LAN-TEST'),
                                ('case_detail', f"/api/cases/{user['case_id']}"), ('calendar', '/api/calendar')]:
                if stop.is_set() or time.monotonic() >= shared['deadline']:
                    break
                try:
                    client.request(label, path)
                except Exception as error:
                    shared['errors'].append({'user': user['username'], 'action': label,
                                             'error': type(error).__name__})
                    if isinstance(error, urllib.error.HTTPError) and error.code >= 500:
                        stop.set()
                        break
                stop.wait(random.uniform(.25, .65))
            stop.wait(random.uniform(2.0, 5.0))
    except Exception as error:
        shared['errors'].append({'user': user['username'], 'action': 'login', 'error': type(error).__name__})
        stop.set()
    finally:
        shared['durations'].append(client.durations)


def load_test(base, credential_file, duration, user_count, sample_interval, mysql_data_dir=None):
    data = json.loads(Path(credential_file).read_text(encoding='utf-8'))
    if data.get('environment') != 'test-only' or len(data.get('users', [])) < user_count:
        raise SystemExit('Need enough distinct users from a test-only seed file.')
    stop = threading.Event()
    shared = {'deadline': time.monotonic() + duration, 'errors': [], 'durations': [], 'logins': 0}
    containers = docker_project_containers()
    samples = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=user_count) as pool:
        futures = [pool.submit(load_user, base, user, duration, stop, shared) for user in data['users'][:user_count]]
        while time.monotonic() < shared['deadline'] and not stop.wait(sample_interval):
            sample = {'timestamp': time.time(), **host_metrics(), 'containers': collect_container_stats(containers),
                      'mysql_status': mysql_status(), 'mysql_disk': disk_counters(mysql_data_dir)}
            samples.append(sample)
        for future in futures:
            future.result()
    grouped = {}
    for per_user in shared['durations']:
        for action, values in per_user.items():
            grouped.setdefault(action, []).extend(values)
    return {'duration_requested_seconds': duration, 'users': user_count, 'logins': shared['logins'],
            'iterations': {key: len(value) for key, value in grouped.items()},
            'latency_ms': {key: {'p50': percentile(value, .5), 'p95': percentile(value, .95),
                                 'max': round(max(value) * 1000, 1)} for key, value in grouped.items()},
            'errors': shared['errors'], 'sample_count': len(samples), 'summary': sample_summary(samples), 'samples': samples,
            'container_names_at_start': containers}


def main():
    global TLS_CONTEXT
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=['smoke', 'idle', 'load'])
    parser.add_argument('--base-url', default='https://localhost:18443')
    parser.add_argument('--credentials', type=Path)
    parser.add_argument('--duration', type=int, default=120)
    parser.add_argument('--users', type=int, default=5)
    parser.add_argument('--sample-interval', type=int, default=5)
    parser.add_argument('--mysql-data-dir', type=Path, help='Host bind mount path for disk activity/wait counters.')
    parser.add_argument('--ca-cert', type=Path, help='Instala el certificado raíz local de Caddy solo para este benchmark.')
    parser.add_argument('--output', type=Path)
    parser.add_argument('--insecure-test-cert', action='store_true', help='Only for local test CA/self-signed certificates; never disable verification in a real deployment.')
    args = parser.parse_args()
    if args.duration < 1 or args.duration > 1800 or args.users < 1 or args.users > 5:
        raise SystemExit('Duration must be 1..1800 seconds and users 1..5.')
    if args.mode in {'smoke', 'load'} and not args.credentials:
        raise SystemExit('--credentials is required for smoke/load.')
    if args.insecure_test_cert:
        TLS_CONTEXT = ssl._create_unverified_context()
    elif args.ca_cert:
        TLS_CONTEXT = ssl.create_default_context(cafile=str(args.ca_cert))
    if args.mode == 'smoke':
        ready_ms = wait_for_ready(args.base_url)
        report = {'mode': 'smoke', 'timestamp': time.time(), 'api_ready_wait_ms': ready_ms,
                  'result': functional_smoke(args.base_url, args.credentials)}
    elif args.mode == 'idle':
        containers = docker_project_containers()
        samples = []
        deadline = time.monotonic() + args.duration
        while time.monotonic() < deadline:
            samples.append({'timestamp': time.time(), **host_metrics(), 'containers': collect_container_stats(containers),
                            'mysql_status': mysql_status(), 'mysql_disk': disk_counters(args.mysql_data_dir)})
            time.sleep(min(args.sample_interval, max(0, deadline - time.monotonic())))
        report = {'mode': 'idle', 'timestamp': time.time(), 'duration_requested_seconds': args.duration,
                  'sample_count': len(samples), 'container_names_at_start': containers,
                  'summary': sample_summary(samples), 'samples': samples}
    else:
        ready_ms = wait_for_ready(args.base_url)
        report = {'mode': 'load', 'timestamp': time.time(), 'api_ready_wait_ms': ready_ms,
                  **load_test(args.base_url, args.credentials, args.duration, args.users, args.sample_interval,
                              args.mysql_data_dir)}
    encoded = json.dumps(report, ensure_ascii=False, indent=2)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(encoded + '\n', encoding='utf-8')
    print(encoded)


if __name__ == '__main__':
    main()
