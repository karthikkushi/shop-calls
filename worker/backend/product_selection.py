"""Read-only supplier comparison. No purchase, selling-price promise or approval."""
from decimal import Decimal,InvalidOperation
from . import supplier

def money(value):
    try:
        n=Decimal(str(value))
        return float(n) if n.is_finite() and n>=0 else None
    except (InvalidOperation,ValueError,TypeError):return None

async def select(topic,destination='IN',quantity=10):
    candidates=[]
    for listing in topic.get('supplier_products',[])[:3]:
        try:
            detail=await supplier.inspect_product(str(listing['id']))
            variants=[v for v in detail['variants'] if v.get('id') and money(v.get('price')) is not None and (v.get('stock') is None or money(v['stock']) is not None and money(v['stock'])>=quantity)]
            if not variants:continue
            variant=min(variants,key=lambda v:money(v['price']))
            freight=await supplier.quote(supplier.FreightRequest(variant_id=variant['id'],origin='CN',destination=destination,quantity=quantity))
            options=[o for o in freight['options'] if money(o.get('total_postage')) is not None or money(o.get('shipping_cost')) is not None]
            def shipping(o):return money(o.get('total_postage')) if money(o.get('total_postage')) is not None else money(o.get('shipping_cost'))
            if not options:continue
            route=min(options,key=shipping);total=round(money(variant['price'])*quantity+shipping(route),2)
            candidates.append({'supplier':'CJdropshipping','product_id':listing['id'],'name':detail.get('name') or listing['name'],'image':detail.get('image') or listing.get('image'),'url':listing['url'],'variant':variant,'destination':destination,'origin':'CN','quantity':quantity,'currency':'USD','route':route,'product_unit_cost':money(variant['price']),'estimated_total':total,'estimated_per_unit':round(total/quantity,2),'checked_at':freight['checked_at'],'stock_confirmed':False,'approved':False,'status':'review_required','reason':'Lowest estimated product + shipping cost among the catalogue candidates with a returned shipping option.','unknowns':['Product fit and quality','Origin warehouse stock','Address-specific shipping, import charges and processing time','Payment fees and your selling margin']})
        except Exception:
            continue
    if not candidates:return {'status':'quote_unavailable','destination':destination,'quantity':quantity,'approved':False,'note':'No comparable quote returned. Do not pitch a fixed price or delivery promise yet.'}
    chosen=min(candidates,key=lambda c:(c['estimated_total'],not bool(c['image'])))
    return {**chosen,'compared_count':len(candidates),'catalogue_candidates':len(topic.get('supplier_products',[]))}
