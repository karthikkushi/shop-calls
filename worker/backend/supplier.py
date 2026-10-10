"""Read-only CJ search. Credentials remain on the server."""
import asyncio
import os
import time
from urllib.parse import urlsplit
from pathlib import Path
import httpx
from dotenv import load_dotenv
from fastapi import APIRouter, HTTPException, Query
router = APIRouter(prefix='/api/supplier', tags=['supplier'])
BASE = 'https://developers.cjdropshipping.com/api2.0/v1/'
_lock = asyncio.Lock()
_token = None
_until = 0
_last = 0

async def call(path, token=None, body=None, params=None):
    global _last
    await asyncio.sleep(max(0, 1.1 - (time.monotonic() - _last)))
    _last = time.monotonic()
    try:
        async with httpx.AsyncClient(timeout=25) as client:
            r = await client.request('POST' if body else 'GET', BASE + path, headers={'CJ-Access-Token': token} if token else {}, json=body, params=params)
            r.raise_for_status()
            result = r.json()
    except (httpx.HTTPError, ValueError):
        raise HTTPException(502, 'CJ could not be reached. Try again later.') from None
    if not isinstance(result, dict) or result.get('result') is not True:
        raise HTTPException(502, 'CJ rejected the request. Check account access or quota.')
    return result.get('data')

async def access_token():
    global _token, _until
    if _token and time.monotonic() < _until: return _token
    load_dotenv(Path(__file__).resolve().parents[1] / '.env', override=True)
    key = os.getenv('CJ_API_KEY', '').strip()
    if not key: raise HTTPException(503, 'CJ API key is not configured locally.')
    d = await call('authentication/getAccessToken', body={'apiKey': key})
    if not isinstance(d, dict) or not d.get('accessToken'): raise HTTPException(502, 'CJ returned no access token.')
    # shortcut: process-local cache and throttle; use shared storage before multiple workers.
    _token, _until = d['accessToken'], time.monotonic() + 3600
    return _token

def supplier_image(value):
    if not isinstance(value, str): return None
    try:
        u = urlsplit(value)
        host = u.hostname or ''
        return value if u.scheme == 'https' and not u.username and not u.password and (host.endswith('.cjdropshipping.com') or host.endswith('.aliyuncs.com')) else None
    except ValueError:
        return None

def products(data):
    if not isinstance(data, dict) or not isinstance(data.get('content'), list): raise HTTPException(502, 'Unexpected CJ catalogue response.')
    rows = []
    for group in data['content']:
        if not isinstance(group, dict) or not isinstance(group.get('productList'), list): raise HTTPException(502, 'Unexpected CJ product group.')
        for p in group['productList']:
            if not isinstance(p, dict): raise HTTPException(502, 'Unexpected CJ product.')
            if not p.get('id'): continue
            rows.append({'id': p['id'], 'name': p.get('nameEn'), 'sku': p.get('sku'), 'listing_price': p.get('sellPrice'), 'image': supplier_image(p.get('bigImage')), 'verified_inventory': p.get('totalVerifiedInventory'), 'url': 'https://www.cjdropshipping.com/product/product-p-' + str(p['id']) + '.html', 'shipping_quote': None, 'approved': False})
    return rows

@router.get('/search')
async def search(query: str = Query(min_length=3, max_length=100)):
    query = query.strip()
    if len(query) < 3: raise HTTPException(422, 'Enter at least three characters.')
    async with _lock:
        token = await access_token()
        data = await call('product/listV2', token=token, params={'keyWord': query, 'page': 1, 'size': 10})
    return {'query': query, 'products': products(data), 'checked_at': time.time(), 'notice': 'Supplier listings only. Shipping, quality and demand are not verified.'}

@router.get('/product/{product_id}')
async def inspect_product(product_id: str):
    import re
    from html.parser import HTMLParser
    if not re.fullmatch(r'[A-Za-z0-9-]{1,80}', product_id):
        raise HTTPException(422, 'Invalid product identifier.')
    async with _lock:
        data = await call('product/query', token=await access_token(), params={'pid': product_id})
    if not isinstance(data, dict) or not isinstance(data.get('variants', []), list):
        raise HTTPException(502, 'Unexpected CJ product details.')
    class Text(HTMLParser):
        def __init__(self):
            super().__init__()
            self.parts = []
        def handle_data(self, text):
            self.parts.append(text)
    parser = Text()
    parser.feed(str(data.get('description') or ''))
    variants = []
    for v in data.get('variants', []):
        if not isinstance(v, dict): raise HTTPException(502, 'Unexpected CJ variant.')
        variants.append({'id': v.get('vid'), 'name': v.get('variantKey') or v.get('variantNameEn'),
            'sku': v.get('variantSku'), 'price': v.get('variantSellPrice'),
            'weight_grams': v.get('variantWeight'), 'stock': v.get('inventoryNum')})
    return {'id': data.get('pid'), 'name': data.get('productNameEn'),
        'image': supplier_image(data.get('bigImage')), 'description': ' '.join(parser.parts)[:8000], 'variants': variants,
        'notice': 'Supplier claims only. Variant price excludes shipping; quality is not verified.'}

from pydantic import BaseModel, Field

class FreightRequest(BaseModel):
    variant_id: str = Field(pattern=r'^[A-Za-z0-9-]{1,80}$')
    origin: str = Field(pattern=r'^[A-Z]{2}$')
    destination: str = Field(pattern=r'^[A-Z]{2}$')
    quantity: int = Field(default=1, ge=1, le=100, strict=True)

@router.post('/quote')
async def quote(request: FreightRequest):
    async with _lock:
        data = await call('logistic/freightCalculate', token=await access_token(), body={
            'startCountryCode': request.origin, 'endCountryCode': request.destination,
            'products': [{'vid': request.variant_id, 'quantity': request.quantity}]})
    if not isinstance(data, list) or any(not isinstance(d, dict) for d in data):
        raise HTTPException(502, 'Unexpected CJ shipping response.')
    return {'origin': request.origin, 'destination': request.destination, 'quantity': request.quantity,
        'currency': 'USD', 'checked_at': time.time(), 'options': [{
            'carrier': d.get('logisticName'), 'shipping_estimate': d.get('logisticAging'),
            'shipping_cost': d.get('logisticPrice'), 'taxes': d.get('taxesFee'),
            'clearance_fee': d.get('clearanceOperationFee'), 'total_postage': d.get('totalPostageFee')
        } for d in data], 'notice': 'Preliminary country-level estimate. Origin stock, address-specific cost, processing time and duties need confirmation.'}
