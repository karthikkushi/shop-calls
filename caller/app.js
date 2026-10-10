const $ = selector => document.querySelector(selector);
const escape = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const labels={new:'To call',no_answer:'No answer',callback:'Follow-up',interested:'Interested',not_interested:'Not interested',booking_requested:'Booking requested',do_not_contact:'Do not contact'};
const categories={desk:'Desk organisation',pet:'Pet grooming',home:'Home storage',travel:'Travel organisation',phone:'Phone accessories'};
const state={code:localStorage.getItem('shop-caller-code')||'',caller:localStorage.getItem('shop-caller-name')||'',
  leads:[],topics:[],country:'IN',tab:'queue',selected:null,requestId:null,loading:false,syncing:false,detailId:null};
const queued=()=>JSON.parse(localStorage.getItem('shop-call-queue')||'[]');
const putQueue=value=>localStorage.setItem('shop-call-queue',JSON.stringify(value));
const date=value=>new Date(value).toLocaleString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});

async function api(path,method='GET',body,code=state.code){
  let r;
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),15000);
  try{r=await fetch((window.SHOP_CONFIG?.apiUrl||'/api/ops')+path,{method,headers:{Authorization:'Bearer '+code,'Content-Type':'application/json'},
      signal:controller.signal,...(body?{body:JSON.stringify(body)}:{})});}
  catch{const e=new Error('Cannot reach the shop service. Check your internet connection; saved responses will retry.');e.offline=true;throw e;}
  finally{clearTimeout(timer);}
  const d=await r.json();
  if(!r.ok){const e=new Error(typeof d.detail==='string'?d.detail:'Check the product, quantity and follow-up details.');e.status=r.status;throw e;}
  return d;
}

function message(text,error=false){$('#message').textContent=text;$('#message').hidden=!text;$('#message').classList.toggle('error',error);}
function safeHref(value){try{const u=new URL(value);return ['https:','http:'].includes(u.protocol)?escape(value):'';}catch{return '';}}
function localTime(lead){try{return new Intl.DateTimeFormat(undefined,{timeZone:lead.timezone,hour:'numeric',minute:'2-digit',weekday:'short'}).format(new Date());}catch{return 'Check shop hours';}}
function render(){
  $('#greeting').textContent=state.caller?'Hello, '+state.caller:'Your calling desk';
  $('#title').textContent={queue:'Shops to call',followup:'Your follow-ups',results:'Shop responses',all:'All shop contacts'}[state.tab];
  const pending=new Map(queued().map(q=>[q.lead_id,q]));
  const count=status=>state.leads.filter(l=>l.status===status).length;
  $('#counts').innerHTML=`<div><b>${count('new')}</b><span>To call</span></div><div><b>${count('interested')}</b><span>Interested</span></div><div><b>${count('booking_requested')}</b><span>Requests</span></div>`;
  const oldCountry=state.country;
  $('#country').innerHTML='<option value="">All countries</option>'+[...new Set(state.leads.map(l=>l.country))].sort().map(c=>`<option value="${escape(c)}">${escape(c)}</option>`).join('');
  $('#country').value=oldCountry;
  const cityBefore=$('#city').value;
  $('#city').innerHTML='<option value="">All cities</option>'+[...new Set(state.leads.filter(l=>!oldCountry||l.country===oldCountry).map(l=>l.city).filter(Boolean))].sort().map(c=>`<option value="${escape(c)}">${escape(c)}</option>`).join('');$('#city').value=cityBefore;
  const country=$('#country').value,category=$('#category').value,search=$('#search').value.toLowerCase().trim();
  const visible=state.leads.filter(l=>{
    if(country&&l.country!==country||category&&l.category!==category)return false;
    if($('#city').value&&l.city!==$('#city').value||$('#response').value&&l.status!==$('#response').value)return false;
    if(search&&!`${l.name} ${l.city} ${l.country}`.toLowerCase().includes(search))return false;
    if(state.tab==='queue')return ['new','no_answer'].includes(l.status)&&!pending.has(l.id);
    if(state.tab==='followup')return l.status==='callback';
    if(state.tab==='results')return !['new','no_answer','callback'].includes(l.status)||pending.has(l.id);
    return true;
  }).sort((a,b)=>state.tab==='followup'?(a.followup||'').localeCompare(b.followup||''):0);
  $('#leads').innerHTML=visible.length?visible.map(l=>{
    const q=pending.get(l.id),tel=/^\+\d{7,15}$/.test(l.phone||'')?l.phone:'';
    const canCall=tel&&l.callable&&!q;
    return `<article class="shop"><div class="shop-heading"><div><h2>${escape(l.name)}</h2><p>${escape(l.city||'')} ${escape(l.country)}</p></div><span class="badge ${escape(l.status)}">${escape(labels[l.status])}</span></div>
      <p class="category">Suggested: ${escape(categories[l.category]||l.category)}</p><p class="local-time">Shop local time: ${escape(localTime(l))}</p>
      <p class="source">${l.source_kind==='overture'?'Map contact · needs verification':'Public website contact'} · <a href="${safeHref(l.source_url)}" target="_blank" rel="noreferrer">Source</a></p>
      ${l.followup?`<p>Call back ${escape(date(l.followup))}</p>`:''}${l.notes?`<p class="note">${escape(l.notes)}</p>`:''}
      ${q?`<p class="pending">${q.error?escape(q.error):'Response saved on phone; waiting to sync.'}</p><button class="quiet" data-retry="${escape(l.id)}">Review pending response</button>`:''}
      ${l.status==='do_not_contact'?'<p class="note">Further calling is blocked.</p>':`<div class="shop-actions">${canCall?`<a class="primary" href="tel:${escape(tel)}">Call shop</a>`:'<span class="hint">'+(q?'Sync response first':'No callable phone')+'</span>'}<button data-outcome="${escape(l.id)}" ${q?'disabled':''}>Save response</button></div>`}
      <button class="details-button" data-details="${escape(l.id)}">Details · Maps · WhatsApp · Call script →</button>
    </article>`;
  }).join(''):`<section class="empty"><h2>${state.leads.length?'Nothing in this list yet':'Waiting for shop leads'}</h2><p>${state.leads.length?'Try another filter or open All shops.':'Run daily research from your dashboard. Contacts will appear here.'}</p></section>`;
  $('#list-count').textContent=visible.length+' shops in this list';
  $('#results-chart').hidden=state.tab!=='results';
  const filtered=state.leads.filter(l=>(!country||l.country===country)&&(!$('#city').value||l.city===$('#city').value)&&(!category||l.category===category));
  $('#results-chart').innerHTML='<h2>Response breakdown</h2>'+['interested','booking_requested','callback','not_interested','no_answer'].map(status=>{const n=filtered.filter(l=>l.status===status).length;return `<div class="chart-row"><span>${labels[status]}</span><progress max="${Math.max(1,filtered.length)}" value="${n}"></progress><b>${n}</b></div>`;}).join('');
  document.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('active',b.dataset.tab===state.tab));
}

async function load(){
  if(!state.code||state.loading)return;
  state.loading=true;
  try{
    const [leads,topics]=await Promise.all([api('/leads'),api('/topics').catch(()=>({topics:state.topics}))]);
    state.leads=leads.leads;state.topics=topics.topics;
    localStorage.setItem('shop-cached-leads',JSON.stringify(state.leads));
    $('#products').innerHTML=state.topics.map(t=>`<option value="${escape(t.product)}"></option>`).join('');
    render();if($('#details').open&&state.detailId){const scroll=$('#details').scrollTop;openDetails(state.detailId);$('#details').scrollTop=scroll;}const n=queued().length;message(n?`${n} phone response${n===1?'':'s'} waiting to sync.`:'');
  }catch(e){
    if(e.status===401){signOut(false);$('#login-error').textContent='Your access code is no longer valid.';}
    else{if(!state.leads.length)state.leads=JSON.parse(localStorage.getItem('shop-cached-leads')||'[]');render();message(e.message+' Showing last downloaded contacts.',true);}
  }finally{state.loading=false;}
}

async function flush(){
  if(state.syncing||!state.code||!navigator.onLine)return;
  state.syncing=true;let saved=0;
  try{
    for(const entry of queued()){
      if(entry.error)continue;
      try{
        await api('/leads/'+encodeURIComponent(entry.lead_id)+'/outcome','POST',entry.body);
        putQueue(queued().filter(q=>q.body.request_id!==entry.body.request_id));saved++;
      }catch(e){
        if(e.offline||e.status>=500)break;
        putQueue(queued().map(q=>q.body.request_id===entry.body.request_id?{...q,error:e.message}:q));
        message(e.message,true);
        if(e.status===401)break;
      }
    }
    if(saved){await load();message(`${saved} response${saved===1?'':'s'} synced to your dashboard.`);}
    else render();
  }finally{state.syncing=false;}
}

function openApp(){ $('#login').hidden=true;$('#app').hidden=false;load().then(flush); }
function signOut(clear=true){
  state.code='';localStorage.removeItem('shop-caller-code');$('#login').hidden=false;$('#app').hidden=true;
  if(clear){state.leads=[];localStorage.removeItem('shop-cached-leads');}
}
$('#login-form').addEventListener('submit',async e=>{
  e.preventDefault();const f=new FormData(e.currentTarget),code=f.get('code').trim();const button=e.currentTarget.querySelector('button');
  button.disabled=true;$('#login-error').textContent='';
  try{await api('/session','POST',{code},code);state.code=code;state.caller=f.get('caller').trim();localStorage.setItem('shop-caller-code',code);localStorage.setItem('shop-caller-name',state.caller);openApp();}
  catch(err){$('#login-error').textContent=err.message;}finally{button.disabled=false;}
});
$('#logout').addEventListener('click',()=>{
  if(queued().length){message('Sync or remove your pending responses before signing out.',true);return;}$('#settings').close();signOut();
});
$('#refresh').addEventListener('click',()=>load().then(flush));
document.querySelectorAll('[data-tab]').forEach(b=>b.addEventListener('click',()=>{state.tab=b.dataset.tab;render();load().then(flush);}));
$('#country').addEventListener('change',()=>{state.country=$('#country').value;$('#city').value='';render();});$('#city').addEventListener('change',render);$('#response').addEventListener('change',render);$('#category').addEventListener('change',render);$('#search').addEventListener('input',render);

function bookingFields(){
  const status=$('#outcome-status').value,booking=status==='booking_requested',callback=status==='callback';
  $('#booking-fields').hidden=!booking;$('#followup-label').hidden=!callback;
  for(const key of ['product','quantity'])$('#outcome-form').elements[key].required=booking;
  $('#outcome-form').elements.followup.required=callback;
}
function openOutcome(id,entry=null){
  state.selected=state.leads.find(l=>l.id===id);if(!state.selected)return;
  $('#outcome-form').reset();$('#shop-title').textContent=state.selected.name;$('#save-error').textContent='';
  state.requestId=crypto.randomUUID?.()||Date.now()+'-'+Math.random().toString(36).slice(2);
  const f=$('#outcome-form');f.elements.notes.value=state.selected.notes||'';
  if(entry){
    for(const key of ['status','product','quantity','target_unit_price','currency','notes']) if(entry.body[key]!=null)f.elements[key].value=entry.body[key];
    if(entry.body.followup){const d=new Date(entry.body.followup);f.elements.followup.value=new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);}
    state.requestId=entry.body.request_id;
    $('#save-error').textContent=entry.error||'This response has not synced yet. Saving will retry it.';
  }
  bookingFields();$('#outcome').showModal();
}
$('#leads').addEventListener('click',e=>{
  const details=e.target.closest('[data-details]');if(details)openDetails(details.dataset.details);
  const b=e.target.closest('[data-outcome]');if(b)openOutcome(b.dataset.outcome);
  const retry=e.target.closest('[data-retry]');if(retry)openOutcome(retry.dataset.retry,queued().find(q=>q.lead_id===retry.dataset.retry));
});
$('#outcome-status').addEventListener('change',bookingFields);$('#close').addEventListener('click',()=>$('#outcome').close());
$('#outcome-form').addEventListener('submit',async e=>{
  e.preventDefault();const f=new FormData(e.currentTarget),lead=state.selected;if(!lead)return;
  if(state.syncing){$('#save-error').textContent='Wait for the current sync to finish, then save.';return;}
  const booking=f.get('status')==='booking_requested',callback=f.get('status')==='callback';
  const body={status:f.get('status'),caller:state.caller,notes:f.get('notes').trim(),request_id:state.requestId,
    expected_version:lead.version,product:booking?f.get('product').trim():'',quantity:booking?Number(f.get('quantity')):null,
    currency:f.get('currency'),target_unit_price:booking&&f.get('target_unit_price')!==''?Number(f.get('target_unit_price')):null,
    followup:callback?new Date(f.get('followup')).toISOString():null};
  const prior=queued().find(q=>q.lead_id===lead.id);
  if(prior && !prior.error)body.expected_version=prior.body.expected_version;
  // A conflict can be reviewed against refreshed data; a new submission identity replaces it.
  if(prior?.error)body.request_id=crypto.randomUUID?.()||Date.now()+'-'+Math.random().toString(36).slice(2);
  const entry={lead_id:lead.id,body};putQueue([...queued().filter(q=>q.lead_id!==lead.id),entry]);
  $('#outcome').close();state.tab='results';render();message('Saved on this phone. Syncing with your dashboard…');
  await flush();
});
window.addEventListener('online',()=>load().then(flush));
function refreshOnReturn(){if(state.code&&!document.hidden&&!$('#outcome').open)load().then(flush);}
window.addEventListener('focus',refreshOnReturn);window.addEventListener('pageshow',refreshOnReturn);document.addEventListener('visibilitychange',refreshOnReturn);
setInterval(refreshOnReturn,20000);
if(state.code)openApp();
if('serviceWorker' in navigator&&window.isSecureContext){
 let updating=false;const wasControlled=Boolean(navigator.serviceWorker.controller);
 navigator.serviceWorker.addEventListener('controllerchange',()=>{
  if(updating||!wasControlled)return;updating=true;
  const reload=()=>{const url=new URL(location.href);url.searchParams.set('rev','supplier-20261011');location.replace(url.href);};
  if($('#outcome').open||$('#details').open||$('#settings').open){message('App update ready. Close this panel and refresh to load it.');document.addEventListener('close',reload,{capture:true,once:true});}
  else reload();
 });
 navigator.serviceWorker.register(new URL('./sw.js',import.meta.url),{scope:new URL('./',import.meta.url).pathname,updateViaCache:'none'}).then(r=>r.update()).catch(()=>{});
}

$('#response').innerHTML+=Object.entries(labels).map(([k,v])=>`<option value="${k}">${v}</option>`).join('');

function openDetails(id){
 state.detailId=id;
 const l=state.leads.find(x=>x.id===id);if(!l)return;
 const blocked=l.status==='do_not_contact',pending=queued().some(q=>q.lead_id===id),phone=/^\+\d{7,15}$/.test(l.phone||'')?l.phone:'';
 const maps='https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(l.name+' '+l.city+' '+l.country);
 $('#detail-body').innerHTML=`<div class="sheet-head"><h2>${escape(l.name)}</h2><button class="quiet" data-dismiss="details">Close</button></div><p>${escape(l.city)} · ${escape(l.country)} · ${escape(localTime(l))}</p><div class="detail-box"><strong class="phone-number">${escape(phone||'Phone unavailable')}</strong><p>Public contact · verify the shop and buyer first.</p>${l.shop_category?`<p>Map shop type: ${escape(l.shop_category.replaceAll('_',' '))}</p>`:''}<div class="contact-grid">${phone&&!blocked&&!pending&&l.callable?`<a class="primary" href="tel:${escape(phone)}">Call shop</a><a class="contact-link" href="https://wa.me/${phone.slice(1)}" target="_blank" rel="noopener">WhatsApp</a>`:''}<a class="contact-link" href="${escape(maps)}" target="_blank" rel="noopener">Maps</a>${safeHref(l.website)?`<a class="contact-link" href="${safeHref(l.website)}" target="_blank" rel="noopener">Website</a>`:''}${phone?'<button class="contact-link" id="copy-phone">Copy phone</button>':''}</div><p class="hint">WhatsApp availability and shop opening hours are unverified.</p></div>${offerHtml(l)}${briefHtml(l)}${l.notes?`<div class="detail-box"><h3>Last saved notes</h3><p>${escape(l.notes)}</p></div>`:''}${l.followup?`<p>Follow-up: ${escape(date(l.followup))}</p>`:''}<a class="contact-link" href="${safeHref(l.source_url)}" target="_blank" rel="noopener">View contact source</a>${!blocked&&!pending?'<button class="primary" id="detail-save">Record response / booking</button>':'<p class="hint">'+(blocked?'Do not contact: outreach is blocked.':'Sync the pending response before another call.')+'</p>'}`;
 $('#copy-phone')?.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(phone);$('#copy-phone').textContent='Copied';}catch{$('#copy-phone').textContent='Select the phone number above';}});
 $('#detail-save')?.addEventListener('click',()=>{$('#details').close();openOutcome(id);});if(!$('#details').open)$('#details').showModal();
}
document.addEventListener('click',e=>{const b=e.target.closest('[data-dismiss]');if(b)document.getElementById(b.dataset.dismiss).close();});
$('#settings-open').addEventListener('click',()=>{const f=$('#settings-form');f.elements.caller.value=state.caller;f.elements.size.value=localStorage.getItem('shop-text-size')||'16';$('#sync-status').textContent=(navigator.onLine?'Online':'Offline')+' · '+queued().length+' responses waiting to sync';$('#settings').showModal();});
$('#settings-form').addEventListener('submit',e=>{e.preventDefault();const f=e.currentTarget;state.caller=f.elements.caller.value.trim();localStorage.setItem('shop-caller-name',state.caller);localStorage.setItem('shop-text-size',f.elements.size.value);document.documentElement.style.fontSize=f.elements.size.value+'px';$('#settings').close();render();});
$('#sync-now').addEventListener('click',()=>{$('#settings').close();load().then(flush);});
document.documentElement.style.fontSize=(localStorage.getItem('shop-text-size')==='18'?'18':'16')+'px';

function briefHtml(lead){
 const b=lead.call_brief;
 const fill=v=>escape(String(v||'').replaceAll('{me}',state.caller));
 if(!b)return `<div class="detail-box"><h3>Confirm the shop first</h3><p>Hello, is this ${escape(lead.name)}? I'm ${escape(state.caller)}. What does your shop mainly sell, and who handles buying stock?</p><p class="hint">A researched brief is not available yet. Confirm product fit before suggesting anything.</p></div>`;
 return `<div class="detail-box"><p class="hint">${escape(b.method)}</p><h3>Say first</h3><p>${fill(b.opening)}</p><h3>Ask</h3><ol>${(b.questions||[]).map(q=>`<li>${fill(q)}</li>`).join('')}</ol><details><summary>Pitch & objection replies</summary><p>${fill(b.pitch)}</p>${(b.objections||[]).map(o=>`<p><strong>${fill(o.they_say)}</strong><br>${fill(o.you_say)}</p>`).join('')}<h3>Next step</h3><p>${fill(b.follow_up)}</p></details><details><summary>Facts behind this brief</summary>${Object.entries(b.facts||{}).map(([k,v])=>`<p class="hint">[${escape(k)}] ${escape(v)}</p>`).join('')}</details></div>`;
}

function offerHtml(lead){
 const r=state.topics.find(t=>t.id===lead.category)?.supplier_recommendation;
 if(!r||r.status!=='review_required')return '';
 return `<div class="detail-box"><h3>Product to review before pitching</h3>${safeHref(r.image)?`<img class="offer-photo" src="${safeHref(r.image)}" alt="${escape(r.name)}" loading="lazy">`:''}<a href="${safeHref(r.url)}" target="_blank" rel="noopener">${escape(r.name)}</a><p>Supplier: CJdropshipping · Variant: ${escape(r.variant?.name||r.variant?.sku)}</p><p>Internal estimate: USD ${escape(r.estimated_per_unit)} / unit for ${escape(r.quantity)} units to ${escape(r.destination)}.</p><p class="hint">Not a selling price. Confirm this product fits the shop; check quality, stock, final charges and your margin before quoting.</p></div>`;
}
