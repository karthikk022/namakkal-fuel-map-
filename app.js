let stations=[], prices={petrol_ltr:108.59,diesel_ltr:93.06,cng_kg:89.5,date:'2026-09-14'};
let filter='all', availOnly=false, truckMode=false, map, markers=[];
let availability={}, waitData={}, cngSubs=[], priceSubs=[], availTime={};
try { availability=JSON.parse(localStorage.getItem('nk_avail')||'{}'); }catch(e){}
try { waitData=JSON.parse(localStorage.getItem('nk_wait')||'{}'); }catch(e){}
try { cngSubs=JSON.parse(localStorage.getItem('nk_cng_sub')||'[]'); }catch(e){}
try { priceSubs=JSON.parse(localStorage.getItem('nk_price_sub')||'[]'); }catch(e){}
try { availTime=JSON.parse(localStorage.getItem('nk_avail_t')||'{}'); }catch(e){}
let current=null, sb=null, liveMode=false, searchQ='', svcFilter=new Set();

function initSupabase(){
  try{
    if(window.SUPABASE_URL && window.SUPABASE_KEY && window.supabase){
      sb=window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_KEY);
      liveMode=true;
      sb.channel('fuel-live')
        .on('postgres_changes',{event:'*',schema:'public',table:'availability'},()=>pullCloud())
        .on('postgres_changes',{event:'INSERT',schema:'public',table:'wait_reports'},()=>pullCloud())
        .subscribe();
      pullCloud();
    }
  }catch(e){}
  try{ const lp=document.getElementById('livePill'); if(lp&&liveMode){ lp.textContent='🟢 Live'; lp.className='price-pill live'; } }catch(e){}
}
async function pullCloud(){
  if(!sb) return;
  try{
    const {data}=await sb.from('availability').select('*');
    if(data){ data.forEach(r=>{ availability[r.station_id+':'+r.fuel]=r.status; if(r.updated_at) availTime[r.station_id+':'+r.fuel]=new Date(r.updated_at).getTime(); }); try{localStorage.setItem('nk_avail_t',JSON.stringify(availTime));}catch(e){} render(); if(current) openModal(current); }
    const {data:w}=await sb.from('wait_reports').select('*').order('created_at',{ascending:false}).limit(200);
    if(w){ const agg={}; w.forEach(r=>{ if(!agg[r.station_id]) agg[r.station_id]={level:r.level,time:new Date(r.created_at).getTime(),count:1}; else agg[r.station_id].count++; }); Object.assign(waitData,agg); render(); }
  }catch(e){}
}
async function pushAvail(station_id,fuel,status){
  availability[station_id+':'+fuel]=status;
  availTime[station_id+':'+fuel]=Date.now();
  try{localStorage.setItem('nk_avail',JSON.stringify(availability));}catch(e){}
  try{localStorage.setItem('nk_avail_t',JSON.stringify(availTime));}catch(e){}
  if(!sb) return;
  try{ await sb.from('availability').upsert({station_id,fuel,status}); }catch(e){}
}
async function pushWait(station_id,level){
  const old=waitFor(station_id);
  waitData[station_id]={level,time:Date.now(),count:(old.count||0)+1};
  try{localStorage.setItem('nk_wait',JSON.stringify(waitData));}catch(e){}
  if(!sb) return;
  try{ await sb.from('wait_reports').insert({station_id,level}); }catch(e){}
}

async function load(){
  const v='?v='+Date.now();
  try{ stations=await fetch('stations.json'+v,{cache:'no-store'}).then(r=>r.json()); }catch(e){}
  try{ const p=await fetch('prices.json'+v,{cache:'no-store'}).then(r=>r.json()); prices={...prices,...p}; }catch(e){}
  try{ sosData=await fetch('sos.json'+v,{cache:'no-store'}).then(r=>r.json()); }catch(e){}
  document.getElementById('priceBar').innerHTML=
    `<span class="price-pill petrol">Petrol ₹${prices.petrol_ltr}</span>`+
    `<span class="price-pill diesel">Diesel ₹${prices.diesel_ltr}</span>`+
    `<span class="price-pill cng">CNG ₹${prices.cng_kg}</span>`+
    `<span class="price-pill" id="livePill">📴 Local</span>`+
    `<span class="price-pill alert" id="dropPill" title="Price drop alert">🔔 Alert</span>`;
  initMap(); render(); bindUI(); checkCngAlerts(); initSupabase(); checkPriceDrop(); fitAll();
  hideLoader();
}
function statusFor(id,f){ return availability[id+':'+f]||'Available'; }
function waitFor(id){ return waitData[id]||{level:'No rush',time:Date.now(),count:0}; }
function initMap(){
  if(map){ map.remove(); markers=[]; }
  map=L.map('map',{attributionControl:false}).setView([11.24,78.14],10);
  L.maplibreGL({
    style:'https://tiles.openfreemap.org/styles/liberty',
    maxZoom:19
  }).addTo(map);
}
function fitAll(){
  if(!stations.length||!map) return;
  try{ map.fitBounds(stations.map(s=>[s.lat,s.lon]),{padding:[20,20]}); }catch(e){}
}

// --- LOADER ---
function hideLoader(){
  const el=document.getElementById('loader');
  if(el){ el.classList.add('hide'); setTimeout(()=>el.remove(),500); }
}

// --- TRUCKER MODE ---
function isTruckStop(s){ return s.has_diesel && (s.truck_parking||s.adblue); }
function truckBadges(s){
  let h='';
  if(s.truck_parking) h+=`<span class="badge Available">🅿 Parking</span>`;
  if(s.adblue) h+=`<span class="badge Available">AdBlue</span>`;
  if(s.upi) h+=`<span class="badge Available">UPI</span>`;
  return h;
}
function popupHTML(s){
  const rows=[];
  if(s.has_ev) rows.push(`⚡ EV: <b>${s.ev_kw||''}</b> — ${statusFor(s.id,'ev')} <small>${s.connectors||''}</small>`);
  if(!truckMode||s.has_diesel){
    if(s.has_petrol&&!truckMode) rows.push(`Petrol: <b>₹${prices.petrol_ltr}</b> — ${statusFor(s.id,'petrol')}${s.has_e20?' <small>E20</small>':''}`);
    if(s.has_diesel) rows.push(`Diesel: <b>₹${prices.diesel_ltr}</b> — ${statusFor(s.id,'diesel')}`);
    if(s.has_cng&&!truckMode) rows.push(`CNG: <b>₹${prices.cng_kg}</b> — ${statusFor(s.id,'cng')}`);
  }
  if(truckMode) rows.push(truckBadges(s));
  return `<b>${s.name}</b><br/><small>${s.address}</small><br/>${rows.join('<br/>')}<br/><button class="pop-btn" onclick="window.openStation('${s.id}')">View / Update</button>`;
}
function render(){
  markers.forEach(m=>{try{map.removeLayer(m);}catch(e){}}); markers=[];
  const list=document.getElementById('list'); list.innerHTML='';
  let shown=0;
  stations.forEach(s=>{
    if(searchQ){
      const q=(s.name+' '+s.address+' '+(s.brand||'')).toLowerCase();
      if(!q.includes(searchQ)) return;
    }
    if(svcFilter.size){
      const sv=s.services||{};
      for(const f of svcFilter){ if(!sv[f]) return; }
    }
    if(truckMode && !isTruckStop(s) && !s.has_ev) return;
    if(!truckMode){
      if(filter==='petrol'&&!s.has_petrol) return;
      if(filter==='diesel'&&!s.has_diesel) return;
      if(filter==='cng'&&!s.has_cng) return;
      if(filter==='ev'&&!s.has_ev) return;
    }
    const st={petrol:s.has_petrol?statusFor(s.id,'petrol'):null,diesel:s.has_diesel?statusFor(s.id,'diesel'):null,cng:s.has_cng?statusFor(s.id,'cng'):null,ev:s.has_ev?statusFor(s.id,'ev'):null};
    if(availOnly&&!Object.values(st).includes('Available')) return;
    shown++;
    const isNear=nearIds.includes(s.id);
    const dTxt=(userPos&&s._d!=null)?` · ${s._d.toFixed(1)} km`:'';
    const color=Object.values(st).includes('Out')?'red':Object.values(st).includes('Low')?'orange':'green';
    const mk=L.circleMarker([s.lat,s.lon],{radius:isNear?14:(truckMode?12:10),color,fillOpacity:0.9,weight:isNear?4:2}).addTo(map);
    mk.bindPopup((isNear?'⭐ Nearest<br/>':'')+popupHTML(s)+(dTxt?`<br/><small>${dTxt} away</small>`:'')); markers.push(mk);
    const div=document.createElement('div'); div.className='stn'+(isNear?' near':'');
    div.innerHTML=`<h3>${isNear?'⭐ ':''}${s.name}</h3><small>${s.address} · ${s.brand}${dTxt}</small><br/>
    ${(!truckMode&&s.has_petrol)?`<span class="badge ${st.petrol}">Petrol · ₹${prices.petrol_ltr}${s.has_e20?' E20':''}</span>`:''}
    ${s.has_diesel?`<span class="badge ${st.diesel}">Diesel · ₹${prices.diesel_ltr}</span>`:''}
    ${(!truckMode&&s.has_cng)?`<span class="badge ${st.cng}">CNG · ₹${prices.cng_kg}</span>`:''}
    ${s.has_ev?`<span class="badge ${st.ev}">⚡ EV · ${s.ev_kw||''}</span>`:''}
    ${svcLine(s)}<br/>${truckMode?truckBadges(s)+'<br/>':''}
    <button>View / Update</button>`;
    div.querySelector('button').addEventListener('click',()=>openModal(s));
    list.appendChild(div);
  });
  document.getElementById('count').textContent=`(${shown})${truckMode?' 🚛 Trucker':''}`;
  if(!shown){
    list.innerHTML=`<div class="stn" style="text-align:center"><h3>No bunks found</h3><small>Try different search or clear filters.</small><br/><br/><button id="clearF">Clear all filters</button></div>`;
    document.getElementById('clearF').onclick=()=>{searchQ='';svcFilter.clear();filter='all';truckMode=false;const se=document.getElementById('search');if(se)se.value='';document.getElementById('searchClear').classList.add('hidden');document.querySelectorAll('[data-svc]').forEach(x=>x.classList.remove('active'));document.querySelectorAll('.filters button[data-f]').forEach(x=>x.classList.toggle('active',x.dataset.f==='all'));document.getElementById('truckMode').classList.remove('active');render();};
  }
}

// --- MODAL ---
function openModal(s){
  if(typeof s==='string') s=stations.find(x=>x.id===s);
  if(!s) return; current=s;
  document.getElementById('mName').textContent=s.name;
  document.getElementById('mAddr').textContent=s.address+' · '+s.brand;
  let html='';
  if(s.has_ev) html+=`⚡ EV ${s.ev_kw||''} (${s.connectors||''}) — <b>${statusLine(s.id,'ev')}</b><br/>`;
  if(!truckMode&&s.has_petrol) html+=`Petrol: ₹${prices.petrol_ltr}/L — <b>${statusLine(s.id,'petrol')}</b>${s.has_e20?' (E20)':''}<br/>`;
  if(s.has_diesel) html+=`Diesel: ₹${prices.diesel_ltr}/L — <b>${statusLine(s.id,'diesel')}</b><br/>`;
  if(!truckMode&&s.has_cng) html+=`CNG: ₹${prices.cng_kg}/kg — <b>${statusLine(s.id,'cng')}</b><br/>`;
  if(truckMode) html+=`${s.truck_parking?'✅ Truck parking<br/>':'❌ No truck parking<br/>'}${s.adblue?'✅ AdBlue available<br/>':'❌ No AdBlue<br/>'}${s.upi?'✅ UPI accepted<br/>':''}`;
  html+=svcLine(s);
  html+=nearbySOSHtml(s,3);
  document.getElementById('mPrices').innerHTML=html;
  document.getElementById('mWait').innerHTML='';
  document.getElementById('mWait').style.display='none';
  const mc=document.getElementById('mCngAlert');
  if(s.has_cng){
    const sub=cngSubs.includes(s.id);
    const cst=statusFor(s.id,'cng');
    const pred=cst!=='Available'?'⚠ High demand — 5 CNG points in Namakkal!':'✅ CNG flowing now';
    mc.innerHTML=`${pred}<br/><button onclick="window.toggleCngSub()" style="margin-top:4px">${sub?'Unsubscribe CNG alert':'🔔 Notify when available'}</button>`;
  } else mc.innerHTML='';
  document.getElementById('modal').classList.remove('hidden');
}
window.openStation=openModal;
window.openSOS=showSOS;
window.setWait=function(level){
  if(!current) return;
  pushWait(current.id,level).then(()=>{ render(); openModal(current); markers.forEach(m=>{if(m.isPopupOpen()) m.setPopupContent(popupHTML(current));}); });
};
window.toggleCngSub=function(){
  if(!current) return;
  if(cngSubs.includes(current.id)) cngSubs=cngSubs.filter(x=>x!==current.id);
  else { cngSubs.push(current.id); if(Notification&&Notification.permission==='default') Notification.requestPermission(); }
  try{localStorage.setItem('nk_cng_sub',JSON.stringify(cngSubs));}catch(e){}
  openModal(current);
};
function checkCngAlerts(){
  cngSubs.forEach(id=>{
    const s=stations.find(x=>x.id===id);
    if(s&&statusFor(id,'cng')==='Available'){
      const msg=`CNG available at ${s.name}!`;
      document.getElementById('priceBar').innerHTML+=` <span class="price-pill live">🔔 ${msg}</span>`;
      try{ if(Notification&&Notification.permission==='granted') new Notification(msg); }catch(e){}
    }
  });
}
function timeAgo(ts){
  if(!ts) return '';
  const m=Math.floor((Date.now()-ts)/60000);
  if(m<1) return 'just now';
  if(m<60) return m+'m ago';
  const h=Math.floor(m/60); if(h<24) return h+'h ago';
  return Math.floor(h/24)+'d ago';
}
function statusLine(id,fuel){
  const s=statusFor(id,fuel), t=availTime[id+':'+fuel];
  return s + (t?` <small>(${timeAgo(t)})</small>`:'');
}
function svcLine(s){
  const sv=s.services||{}; let h='';
  if(sv.food) h+=`<span class="badge Available">🍲 Food</span>`;
  if(sv.restroom) h+=`<span class="badge Available">🚻 Restroom</span>`;
  if(sv.air) h+=`<span class="badge Available">💨 Air</span>`;
  if(sv.mechanic) h+=`<span class="badge Available">🔧 Mechanic</span>`;
  return h?'<br/>'+h:'';
}
async function checkPriceDrop(){
  try{
    const h=await fetch('price-history.json?v='+Date.now(),{cache:'no-store'}).then(r=>r.json());
    if(h.length<2) return;
    const y=h[h.length-2], t=h[h.length-1];
    const dp=(t.petrol-y.petrol).toFixed(2), dd=(t.diesel-y.diesel).toFixed(2);
    const pill=document.getElementById('dropPill');
    if(!pill) return;
    if(parseFloat(dp)<0||parseFloat(dd)<0){
      pill.textContent=`📉 Petrol ${dp} Diesel ${dd}`;
      pill.style.background='#16A34A';
      if(priceSubs.includes('drop')&&Notification&&Notification.permission==='granted') try{new Notification(`Fuel drop: petrol ${dp}, diesel ${dd}`);}catch(e){}
    } else pill.textContent='🔔 No drop';
    pill.onclick=()=>{
      if(Notification&&Notification.permission==='default') Notification.requestPermission();
      if(priceSubs.includes('drop')){ priceSubs=[]; pill.textContent='🔔 Alert off'; pill.style.background=''; }
      else{ priceSubs=['drop']; pill.textContent='🔔 Alerts ON'; }
      try{localStorage.setItem('nk_price_sub',JSON.stringify(priceSubs));}catch(e){}
    };
  }catch(e){}
}

// --- BIND UI ---
function bindUI(){
  // Fuel filters
  document.querySelectorAll('.filters button[data-f]').forEach(b=>{
    b.onclick=()=>{document.querySelectorAll('.filters button[data-f]').forEach(x=>x.classList.remove('active'));b.classList.add('active');filter=b.dataset.f;truckMode=false;document.getElementById('truckMode').classList.remove('active');render();};
  });
  document.getElementById('truckMode').onclick=(e)=>{truckMode=!truckMode;e.target.classList.toggle('active');render();};

  // Modal close
  document.getElementById('mClose').onclick=()=>document.getElementById('modal').classList.add('hidden');
  document.getElementById('modal').addEventListener('click',(e)=>{if(e.target.id==='modal') e.target.classList.add('hidden');});

  // Save
  document.getElementById('mSave').onclick=()=>{
    if(!current) return;
    const f=document.getElementById('mFuel').value,st=document.getElementById('mStatus').value;
    pushAvail(current.id,f,st).then(()=>{ render(); openModal(current); checkCngAlerts(); markers.forEach(m=>{if(m.isPopupOpen()) m.setPopupContent(popupHTML(current));}); });
  };

  // Direction
  document.getElementById('mDir').onclick=()=>{
    if(!current) return;
    if(window.routeCtrl){ try{map.removeControl(window.routeCtrl);}catch(e){} window.routeCtrl=null; }
    const dest=L.latLng(current.lat,current.lon);
    let waypoints=[dest];
    if(userPos) waypoints=[L.latLng(userPos.lat,userPos.lon), dest];
    try{
      window.routeCtrl=L.Routing.control({
        waypoints:waypoints,
        lineOptions:{styles:[{color:'#16A34A',weight:5}]},
        createMarker:function(){return null;},
        show:true,
        fitSelectedRoutes:true,
        routeWhileDragging:false
      }).addTo(map);
      setTimeout(()=>{
        const rc=document.querySelector('.leaflet-routing-container');
        if(rc){
          const btn=document.createElement('div');
          btn.textContent='✕';
          btn.style.cssText='position:absolute;top:8px;right:10px;font-size:18px;cursor:pointer;color:#101D42;font-weight:bold;z-index:10;line-height:1';
          btn.onclick=()=>{try{map.removeControl(window.routeCtrl);}catch(e){} window.routeCtrl=null;};
          rc.style.position='relative';
          rc.appendChild(btn);
        }
      },200);
      map.closePopup();
      document.getElementById('modal').classList.add('hidden');
      map.setView(dest,13);
      if(!userPos) alert('Allow GPS for full route. Use Nearest first to set your location.');
    }catch(e){ alert('Route error: '+e.message+'. Try again.'); }
  };

  // Trend
  document.getElementById('trendBtn').onclick=showTrend;
  document.getElementById('trendClose').onclick=()=>document.getElementById('trendModal').classList.add('hidden');
  document.getElementById('trendModal').addEventListener('click',(e)=>{if(e.target.id==='trendModal') e.target.classList.add('hidden');});

  // Nearest
  document.getElementById('nearBtn').onclick=findNearest;

  // SOS
  document.getElementById('sosBtn').onclick=showSOS;
  document.getElementById('sosClose').onclick=()=>document.getElementById('sosModal').classList.add('hidden');
  document.getElementById('sosModal').addEventListener('click',(e)=>{if(e.target.id==='sosModal') e.target.classList.add('hidden');});
  document.querySelectorAll('[data-sos]').forEach(b=>b.onclick=()=>{document.querySelectorAll('[data-sos]').forEach(x=>x.classList.remove('active'));b.classList.add('active');renderSOS(b.dataset.sos);});

  // Search + clear
  const se=document.getElementById('search');
  const sc=document.getElementById('searchClear');
  if(se){
    se.oninput=(e)=>{searchQ=e.target.value.trim().toLowerCase();sc.classList.toggle('hidden',!searchQ);render();};
    sc.onclick=()=>{se.value='';searchQ='';sc.classList.add('hidden');render();};
  }

  // Service filters
  document.querySelectorAll('[data-svc]').forEach(b=>b.onclick=()=>{const k=b.dataset.svc;if(svcFilter.has(k)){svcFilter.delete(k);b.classList.remove('active');}else{svcFilter.add(k);b.classList.add('active');}render();});

  // ESC to close modals
  document.addEventListener('keydown',(e)=>{
    if(e.key==='Escape'){
      document.getElementById('modal').classList.add('hidden');
      document.getElementById('trendModal').classList.add('hidden');
      document.getElementById('sosModal').classList.add('hidden');
    }
    // / to focus search
    if(e.key==='/'&&document.activeElement.tagName!=='INPUT'){
      e.preventDefault();se&&se.focus();
    }
  });

  // Scroll to top button
  const st=document.getElementById('scrollTop');
  const panel=document.getElementById('panel');
  if(panel){
    panel.addEventListener('scroll',()=>{st.classList.toggle('hidden',panel.scrollTop<200);});
    st.onclick=()=>panel.scrollTo({top:0,behavior:'smooth'});
  }
}

// --- SOS ---
let sosData=[], sosFilter='all';
function sosCall(x){
  if(x.phone) return `<a href="tel:${x.phone}" class="sos-call">📞 ${x.phone}</a>`;
  return `<span class="sos-pending">verifying — call 100 / 108</span>`;
}
function nearbySOSHtml(s,maxKm){
  if(!sosData||!sosData.length) return `<small>🆘 <a href="#" onclick="window.openSOS();return false;">SOS</a></small>`;
  const near=sosData.map(x=>({...x,d:distKm(s.lat,s.lon,x.lat,x.lon)})).filter(x=>x.d<=maxKm).sort((a,b)=>a.d-b.d).slice(0,2);
  if(!near.length){
    const one=sosData.map(x=>({...x,d:distKm(s.lat,s.lon,x.lat,x.lon)})).sort((a,b)=>a.d-b.d)[0];
    if(!one) return '';
    return `<div class="sos-nearby">🆘 ${one.d.toFixed(1)}km: ${one.name} ${sosCall(one)}</div>`;
  }
  return `<div class="sos-nearby">🆘 Within ${maxKm}km:<br/>`+near.map(x=>`· ${x.name} ${x.d.toFixed(1)}km ${sosCall(x)}`).join('<br/>')+`</div>`;
}
async function showSOS(){
  document.getElementById('sosModal').classList.remove('hidden');
  try{ sosData=await fetch('sos.json?v='+Date.now(),{cache:'no-store'}).then(r=>r.json()); }catch(e){}
  renderSOS('all');
}
function renderSOS(f){
  sosFilter=f;
  const ref=current||(userPos?{lat:userPos.lat,lon:userPos.lon}:{lat:11.2189,lon:78.1671});
  const list=document.getElementById('sosList'); list.innerHTML='';
  sosData.filter(s=>f==='all'||s.type===f||(f==='mechanic'&&s.type==='tow')).forEach(s=>{
    const d=distKm(ref.lat,ref.lon,s.lat,s.lon);
    const icon=s.type==='hospital'?'🏥':s.type==='mechanic'?'🔧':s.type==='puncture'?'🛞':s.type==='tow'?'🚚':'🚔';
    const div=document.createElement('div'); div.className='stn';
    const callBtn=s.phone?`<a href="tel:${s.phone}" class="sos-call">📞 ${s.phone}</a>`:`<span class="sos-pending">verifying — call 100 / 108</span>`;
    div.innerHTML=`<h3>${icon} ${s.name}</h3><small>${s.address} · ${d.toFixed(1)} km</small><div class="row" style="margin-top:6px">${callBtn}<button data-lat="${s.lat}" data-lon="${s.lon}">Go</button></div>`;
    div.querySelector('button').onclick=(e)=>{window.open(`https://www.google.com/maps/dir/?api=1&destination=${e.target.dataset.lat},${e.target.dataset.lon}`,'_blank');};
    list.appendChild(div);
  });
  if(!list.children.length) list.innerHTML='<small>No SOS in this category yet.</small>';
}

// --- NEAREST ---
let userPos=null, nearIds=[], userMarker=null;
function distKm(a,b,c,d){ const R=6371,r=x=>x*Math.PI/180; const h=Math.sin(r(c-a)/2)**2+Math.cos(r(a))*Math.cos(r(c))*Math.sin(r(d-b)/2)**2; return 2*R*Math.asin(Math.sqrt(h)); }
function findNearest(){
  if(!navigator.geolocation){ alert('GPS not supported'); return; }
  const btn=document.getElementById('nearBtn'); btn.textContent='⌛ Locating...';
  navigator.geolocation.getCurrentPosition(pos=>{
    userPos={lat:pos.coords.latitude,lon:pos.coords.longitude};
    btn.textContent='📍 Nearest';
    if(userMarker){ try{map.removeLayer(userMarker);}catch(e){} }
    userMarker=L.circleMarker([userPos.lat,userPos.lon],{radius:9,color:'#2563EB',fillColor:'#2563EB',fillOpacity:1}).addTo(map).bindPopup('You are here').openPopup();
    map.setView([userPos.lat,userPos.lon],12);
    let pool=stations.filter(s=>{
      if(filter==='petrol'&&!s.has_petrol) return false;
      if(filter==='diesel'&&!s.has_diesel) return false;
      if(filter==='cng'&&!s.has_cng) return false;
      if(truckMode&&!isTruckStop(s)) return false;
      return true;
    });
    pool.forEach(s=>s._d=distKm(userPos.lat,userPos.lon,s.lat,s.lon));
    pool.sort((a,b)=>a._d-b._d);
    nearIds=pool.slice(0,3).map(s=>s.id);
    render();
    const top=pool[0];
    if(top) document.getElementById('count').textContent=`(nearest ${top.name} ${top._d.toFixed(1)}km)`;
  },err=>{ btn.textContent='📍 Nearest'; alert('GPS blocked — allow location. '+err.message); },{timeout:10000});
}

// --- TREND ---
let trendChart=null;
async function showTrend(){
  document.getElementById('trendModal').classList.remove('hidden');
  let h=[];
  try{ h=await fetch('price-history.json?v='+Date.now(),{cache:'no-store'}).then(r=>r.json()); }catch(e){}
  const labels=h.map(x=>x.date.slice(5)), pet=h.map(x=>x.petrol), die=h.map(x=>x.diesel);
  const lo=Math.min(...pet), hi=Math.max(...pet);
  document.getElementById('trendNote').textContent=`Petrol range ₹${lo} – ₹${hi} over 10 days. Diesel ₹${prices.diesel_ltr}. Updated daily 6AM IST.`;
  if(trendChart) trendChart.destroy();
  trendChart=new Chart(document.getElementById('trendChart'),{type:'line',data:{labels,datasets:[{label:'Petrol',data:pet,borderColor:'#16a34a',backgroundColor:'#16a34a20',tension:0.3,fill:true},{label:'Diesel',data:die,borderColor:'#ea580c',backgroundColor:'#ea580c20',tension:0.3,fill:true}]},options:{plugins:{legend:{display:true}},scales:{y:{ticks:{callback:v=>'₹'+v}}}}});
}

load();
