const $ = selector => document.querySelector(selector);
const escape = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const labels={new:'To call',no_answer:'No answer',callback:'Follow-up',interested:'Interested',not_interested:'Not interested',booking_requested:'Booking requested',do_not_contact:'Do not contact'};
const categories={desk:'Desk organisation',pet:'Pet grooming',home:'Home storage',travel:'Travel organisation',phone:'Phone accessories'};
const state={code:localStorage.getItem('shop-caller-code')||'',caller:localStorage.getItem('shop-caller-name')||'',
  leads:[],topics:[],tab:'queue',selected:null,requestId:null,loading:false,syncing:false};
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
  const oldCountry=$('#country').value;
  $('#country').innerHTML='<option value="">All countries</option>'+[...new Set(state.leads.map(l=>l.country))].sort().map(c=>`<option value="${escape(c)}">${escape(c)}</option>`).join('');
  $('#country').value=oldCountry;
  const country=$('#country').value,category=$('#category').value,search=$('#search').value.toLowerCase().trim();
  const visible=state.leads.filter(l=>{
    if(country&&l.country!==country||category&&l.category!==category)return false;
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
      <p class="category">${escape(categories[l.category]||l.category)}</p><p class="local-time">Shop local time: ${escape(localTime(l))}</p>
      <p class="source">${l.source_kind==='overture'?'Map contact · needs verification':'Public website contact'} · <a href="${safeHref(l.source_url)}" target="_blank" rel="noreferrer">Source</a></p>
      ${l.followup?`<p>Call back ${escape(date(l.followup))}</p>`:''}${l.notes?`<p class="note">${escape(l.notes)}</p>`:''}
      ${q?`<p class="pending">${q.error?escape(q.error):'Response saved on phone; waiting to sync.'}</p><button class="quiet" data-retry="${escape(l.id)}">Review pending response</button>`:''}
      ${l.status==='do_not_contact'?'<p class="note">Further calling is blocked.</p>':`<div class="shop-actions">${canCall?`<a class="primary" href="tel:${escape(tel)}">Call shop</a>`:'<span class="hint">'+(q?'Sync response first':'No callable phone')+'</span>'}<button data-outcome="${escape(l.id)}" ${q?'disabled':''}>Save response</button></div>`}
    </article>`;
  }).join(''):`<section class="empty"><h2>${state.leads.length?'Nothing in this list yet':'Waiting for shop leads'}</h2><p>${state.leads.length?'Try another filter or open All shops.':'Run daily research from your dashboard. Contacts will appear here.'}</p></section>`;
  document.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('active',b.dataset.tab===state.tab));
}

async function load(){
  if(!state.code||state.loading)return;
  state.loading=true;
  try{
    const [leads,topics]=await Promise.all([api('/leads'),api('/topics')]);
    state.leads=leads.leads;state.topics=topics.topics;
    localStorage.setItem('shop-cached-leads',JSON.stringify(state.leads));
    $('#products').innerHTML=state.topics.map(t=>`<option value="${escape(t.product)}"></option>`).join('');
    render();const n=queued().length;message(n?`${n} phone response${n===1?'':'s'} waiting to sync.`:'');
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
  if(queued().length){message('Sync or remove your pending responses before signing out.',true);return;}signOut();
});
$('#refresh').addEventListener('click',()=>load().then(flush));
document.querySelectorAll('[data-tab]').forEach(b=>b.addEventListener('click',()=>{state.tab=b.dataset.tab;render();}));
['country','category'].forEach(id=>$('#'+id).addEventListener('change',render));$('#search').addEventListener('input',render);

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
setInterval(()=>{if(state.code&&!$('#outcome').open)load().then(flush);},20000);
if(state.code)openApp();
if('serviceWorker' in navigator&&window.isSecureContext)navigator.serviceWorker.register(new URL('./sw.js',import.meta.url),{scope:new URL('./',import.meta.url).pathname}).catch(()=>{});
