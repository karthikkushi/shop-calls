"""Run from worker/: python -m pytest backend"""
import json

from backend import shop_cloud


def test_batches_stay_under_the_cloud_limits_and_keep_every_item():
    items = [{'id': str(i), 'name': 'Shop ' + 'x' * 200} for i in range(5000)]
    parts = list(shop_cloud.batches(items, limit=50_000, most=3000))
    assert [i for p in parts for i in p] == items
    assert all(len(json.dumps(p)) <= 50_000 and len(p) <= 3000 for p in parts)
    assert len(parts) > 1
    assert list(shop_cloud.batches([])) == []


def test_sync_sends_leads_and_topics_in_several_small_requests(monkeypatch):
    sent = []
    monkeypatch.setattr(shop_cloud, 'request', lambda path, method, body: sent.append(body) or {'synced': True})
    monkeypatch.setattr(shop_cloud, 'LIMIT', 2_000)
    leads = [{'id': str(i), 'note': 'y' * 100} for i in range(60)]
    shop_cloud.send(leads, [{'id': 't1'}])
    assert len(sent) > 1
    assert [x for b in sent for x in b['leads']] == leads
    assert [x for b in sent for x in b['topics']] == [{'id': 't1'}]
    assert all(len(json.dumps(b)) < 2_000 + 100 for b in sent)
