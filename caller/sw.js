const CACHE='fieldwork-caller-v6';
const SHELL=['./','./app.js?v=supplier-20261011','./config.js?v=supplier-20261011','./style.css?v=supplier-20261011','./icon.svg','./manifest.webmanifest'].map(p=>{const u=new URL(p,self.registration.scope);return u.pathname+u.search;});
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL.map(p=>new Request(p,{cache:'reload'})))).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('fieldwork-caller-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
 const u=new URL(e.request.url);
 if(e.request.method!=='GET'||u.origin!==self.location.origin||!SHELL.includes(u.pathname+u.search))return;
 e.respondWith(fetch(e.request,{cache:'no-cache'}).then(r=>{if(r.ok){const copy=r.clone();caches.open(CACHE).then(c=>c.put(e.request,copy));}return r;}).catch(()=>caches.match(e.request)));
});
