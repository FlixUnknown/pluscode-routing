// ── Service Worker Offline ─────────────────────────────────
if("serviceWorker" in navigator && location.protocol.startsWith("http")){
  window.addEventListener("load",()=>{
    navigator.serviceWorker.register("./sw.js").catch(()=>{});
  });
}

// ── Hằng số & Helpers (Xe máy max 90km/ngày, Ô tô max 165km/ngày) ──
const EAR=6371,ROAD=1.35;
const MODES={
  xemay:{label:"Xe máy",max:4,spd:35,maxKm:90},
  oto:{label:"Ô tô",max:6,spd:40,maxKm:165}
};
const escHtml=s=>String(s||"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const normVN=s=>String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/đ/g,"d").replace(/Đ/g,"D").toLowerCase().trim();
const parseCoord=v=>{if(v===null||v===undefined||v==="")return NaN;if(typeof v==="number")return v;return parseFloat(String(v).replace(",",".").trim());};
const nowHHMM=()=>{const d=new Date();return String(d.getHours()).padStart(2,"0")+":"+String(d.getMinutes()).padStart(2,"0");};
const hmToMin=(s,fb)=>{const m=String(s||"").match(/^(\d{1,2}):(\d{2})$/);return m?Number(m[1])*60+Number(m[2]):fb;};

let toastTimer=null;
function toast(msg){
  const el=document.getElementById("toast");if(!el)return;
  el.textContent=msg;el.classList.add("show");
  clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove("show"),2800);
}

function openDlg(id){const el=document.getElementById(id);if(el)el.classList.add("open");}
function closeDlg(id){const el=document.getElementById(id);if(el)el.classList.remove("open");}

function dedupeNames(items){
  const used=new Set();let renamed=0;
  const out=items.map(item=>{
    let nm=item.name;
    if(!used.has(nm)){used.add(nm);return item;}
    renamed++;
    let n=2;
    while(used.has(`${item.name} (${n})`))n++;
    nm=`${item.name} (${n})`;
    used.add(nm);
    return{...item,name:nm};
  });
  return{items:out,renamed};
}

// ── State ───────────────────────────────────────────────────
const ldj=(k,f)=>{try{const v=localStorage.getItem(k);return v?JSON.parse(v):f;}catch{return f;}};
const initMode=localStorage.getItem("lt_mode")||"xemay";
const st={
  raw:ldj("lt_raw",{shops:[
    {name:"CH Hội An Center",lon:108.338,lat:15.880,province:"Quảng Nam",address:"Trung tâm Hội An",freqDays:7,lastVisit:"",svcMin:0},
    {name:"CH Điện Bàn",lon:108.253,lat:15.891,province:"Quảng Nam",address:"TX Điện Bàn",freqDays:7,lastVisit:"",svcMin:0},
    {name:"CH Tam Kỳ 1",lon:108.474,lat:15.573,province:"Quảng Nam",address:"TP Tam Kỳ",freqDays:14,lastVisit:"",svcMin:0},
    {name:"CH Núi Thành",lon:108.647,lat:15.424,province:"Quảng Nam",address:"Huyện Núi Thành",freqDays:14,lastVisit:"",svcMin:0},
    {name:"CH TP Quảng Ngãi",lon:108.804,lat:15.121,province:"Quảng Ngãi",address:"TP Quảng Ngãi",freqDays:14,lastVisit:"",svcMin:0},
    {name:"CH Đức Phổ",lon:108.958,lat:14.808,province:"Quảng Ngãi",address:"TX Đức Phổ",freqDays:30,lastVisit:"",svcMin:0},
    {name:"CH TP Kon Tum",lon:108.007,lat:14.349,province:"Kon Tum",address:"TP Kon Tum",freqDays:30,lastVisit:"",svcMin:0},
    {name:"CH Đăk Hà",lon:107.921,lat:14.521,province:"Kon Tum",address:"Huyện Đăk Hà",freqDays:30,lastVisit:"",svcMin:0},
    {name:"CH Tuy Hòa",lon:109.306,lat:13.095,province:"Phú Yên",address:"TP Tuy Hòa",freqDays:30,lastVisit:"",svcMin:0}
  ],hotels:[
    {name:"KS Mường Thanh QNam",lon:108.481,lat:15.565,province:"Quảng Nam"},
    {name:"KS Indochine KTum",lon:108.004,lat:14.354,province:"Kon Tum"},
    {name:"KS CenDeluxe TuyHoa",lon:109.310,lat:13.091,province:"Phú Yên"}
  ],precomputed:[]}),
  cfg:ldj("lt_cfg",{ws:"08:00",ls:"11:00",le:"13:00",we:"17:00",svc:30}),
  custom_order:ldj("lt_order",null),
  day_end_points:ldj("lt_day_ends",{}),
  day_start_times:ldj("lt_day_starts",{}),
  postponed_day:ldj("lt_postponed",{}),
  trip_end_point:ldj("lt_trip_end",null),
  schedule:[],hotels_by_day:{},day_calendar:{},weather_by_day:{},osrm_by_day:{},day_km_over:{},
  sel_day:1,sel_provinces:ldj("lt_sel_provs",[]),search:"",status_filter:"all",edit_mode:false,bnav_tab:"list",
  checkins:ldj("lt_ci",{}),
  visit_history:ldj("lt_history",{}),
  mode:MODES[initMode]?initMode:"xemay",
  max_shops:Number(localStorage.getItem("lt_max"))||MODES[initMode]?.max||4,
  max_km:Number(localStorage.getItem("lt_max_km"))||MODES[initMode]?.maxKm||90,
  excel_src:localStorage.getItem("lt_src")||"optimize",
  start_date:localStorage.getItem("lt_start_date")||toLocalIso(),
  skip_off_days:localStorage.getItem("lt_skip_off")==="1",
  only_due:localStorage.getItem("lt_only_due")==="1",
  avoid_highways:localStorage.getItem("lt_avoid_hw")==="1",
  nav_label_mode:localStorage.getItem("lt_nav_label")||"coords",
  inc_hotel_route:localStorage.getItem("lt_inc_hotel")!=="0",
  fuel_rate:Number(localStorage.getItem("lt_fuel_rate"))||2500,
  needs_reopt:localStorage.getItem("lt_reopt")==="1",
  my_pos:null,live_watch_id:null,dismissed_near:{},duplicates:[]
};

const getWorkCfg=(day=null)=>{
  const wsStr=(day&&st.day_start_times[day])?st.day_start_times[day]:st.cfg.ws;
  return{
    ws:hmToMin(wsStr,480),
    ls:hmToMin(st.cfg.ls,660),
    le:hmToMin(st.cfg.le,780),
    we:hmToMin(st.cfg.we,1020),
    svc:Math.max(5,Number(st.cfg.svc)||30)
  };
};

const getCI=name=>{
  const v=st.checkins[name];
  if(!v)return null;
  if(v===true)return{done:true,time:"",note:""};
  return v.done?v:null;
};

function getShopMeta(name){
  return st.raw.shops.find(s=>s.name===name)||null;
}

function getAllProvinces(){
  return [...new Set((st.raw.shops.length?st.raw.shops:st.schedule).map(s=>s.province).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"vi"));
}

function hotelMatchesFilter(h,vis){
  if(!h)return false;
  if(st.sel_provinces.length===0)return true;
  if(h.type==="last_shop")return Boolean(vis.length&&st.sel_provinces.includes(vis[vis.length-1].province));
  return Boolean(h.province&&st.sel_provinces.includes(h.province));
}

// ── Leaflet ─────────────────────────────────────────────────
const esriStreet=L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",{attribution:"© Esri",maxZoom:19});
const esriTopo=L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}",{attribution:"© Esri",maxZoom:19});
const osmLayer=L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png",{attribution:"© OpenStreetMap",maxZoom:19});

const lmap=L.map("map",{zoomControl:true,layers:[esriStreet]}).setView([15,108.4],7);
L.control.layers({"🗺️ Đường phố":esriStreet,"⛰️ Địa hình":esriTopo,"🌐 OpenStreetMap":osmLayer},null,{position:"topright"}).addTo(lmap);
let lmarkers=[],lmarkerByStt={},lpoly=null,lpolyAlt=null,myPosMarker=null;

function mkIcon(lbl,color,done){
  const bg=done?"#00a86b":color;
  return L.divIcon({className:"",html:`<div style="background:${bg};border:2px solid #fff;border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:11px;font-weight:700;box-shadow:0 2px 6px rgba(0,0,0,.3);">${escHtml(lbl)}</div>`,iconSize:[28,28],iconAnchor:[14,14],popupAnchor:[0,-16]});
}

function renderMap(){
  lmarkers.forEach(m=>lmap.removeLayer(m)); lmarkers=[]; lmarkerByStt={};
  if(lpoly){lmap.removeLayer(lpoly);lpoly=null;}
  if(lpolyAlt){lmap.removeLayer(lpolyAlt);lpolyAlt=null;}
  const stops=visibleStops(); if(!stops.length)return;
  const pts=[];
  const perDayMode=(!st.search&&st.sel_day!==0);
  const fullDayNoFilter=(perDayMode&&st.status_filter==="all"&&st.sel_provinces.length===0);

  if(fullDayNoFilter&&st.sel_day===1&&st.day_end_points[0]?.lat!=null){
    const s0=st.day_end_points[0];
    const sm=L.marker([s0.lat,s0.lon],{icon:mkIcon("S","#2563eb",false)})
      .bindPopup(`<strong>🚩 Xuất phát Ngày 1</strong><br/>${escHtml(s0.name)}`)
      .addTo(lmap);
    lmarkers.push(sm); pts.push([s0.lat,s0.lon]);
  }
  const osrmTimes=fullDayNoFilter?getDisplayTimesForDay(st.sel_day,stops):{};
  stops.forEach(s=>{
    const ci=getCI(s.name);
    const meta=getShopMeta(s.name)||s;
    const lbl=perDayMode?(s.dayStt||s.stt):s.stt;
    const dt=osrmTimes[s.stt]||{arriveTime:s.arriveTime,departTime:s.departTime,overtime:s.overtime};
    const m=L.marker([s.lat,s.lon],{icon:mkIcon(lbl,"#0f4c81",!!ci)})
      .bindPopup(`<strong>#${lbl} ${escHtml(s.name)}</strong>${meta.address?`<br/>🏠 ${escHtml(meta.address)}`:""}<br/>${escHtml(s.province)} · Ngày ${s.day}<br/>⏰ ${escHtml(dt.arriveTime)}–${escHtml(dt.departTime)}${dt.overtime?" ⚠️ Quá giờ":""}${ci?.note?`<br/>📝 ${escHtml(ci.note)}`:""}<br/><a class="popup-nav" href="${navUrl(s)}" target="_blank" rel="noopener noreferrer">🧭 Chỉ đường Google Maps</a>`)
      .addTo(lmap);
    lmarkers.push(m); lmarkerByStt[s.stt]=m; pts.push([s.lat,s.lon]);
  });
  const h=(perDayMode&&st.status_filter==="all")?st.hotels_by_day[st.sel_day]:null;
  if(h?.lat!=null&&h?.lon!=null&&h.type!=="last_shop"&&hotelMatchesFilter(h,stops)){
    const hm=L.marker([h.lat,h.lon],{icon:mkIcon("H","#e67e22",false)})
      .bindPopup(`<strong>🏨 ${escHtml(h.name)}</strong><br/>Cách điểm cuối ~${(h.dist||0).toFixed(1)} km<br/><a class="popup-nav" href="https://www.google.com/maps/dir/?api=1&destination=${h.lat},${h.lon}&travelmode=driving${st.mode==="oto"&&st.avoid_highways?"&avoid=highways":""}" target="_blank" rel="noopener noreferrer">🧭 Chỉ đường</a>`)
      .addTo(lmap);
    lmarkers.push(hm); pts.push([h.lat,h.lon]);
  }

  const osrm=fullDayNoFilter?st.osrm_by_day[st.sel_day]:null;
  if(!st.search&&st.status_filter==="all"){
    if(osrm?.alt?.polyline?.length>=2&&st.mode==="oto"){
      lpolyAlt=L.polyline(osrm.alt.polyline,{color:"#94a3b8",weight:3,opacity:.65,dashArray:"5,5"}).addTo(lmap);
    }
    if(osrm?.polyline?.length>=2){
      lpoly=L.polyline(osrm.polyline,{color:"#1d4ed8",weight:4,opacity:.85}).addTo(lmap);
    }else if(pts.length>=2){
      lpoly=L.polyline(pts,{color:"#0f4c81",weight:3,opacity:.7,dashArray:"6,4"}).addTo(lmap);
    }
  }
  if(pts.length) lmap.fitBounds(L.latLngBounds(pts),{padding:[20,20]});
}

function focusStop(stt){
  const s=st.schedule.find(x=>x.stt===stt);if(!s)return;
  if(document.body.classList.contains("map-collapsed"))toggleMapMobile();
  lmap.flyTo([s.lat,s.lon],14,{duration:.5});
  if(lmarkerByStt[stt])setTimeout(()=>lmarkerByStt[stt].openPopup(),350);
}

function toggleMapMobile(){
  const c=document.body.classList.toggle("map-collapsed");
  if(c)document.body.classList.remove("map-expanded");
  document.getElementById("btn-map-tog").textContent=c?"🗺️ Hiện":"🗺️ Ẩn";
  setTimeout(()=>lmap.invalidateSize(),220);
}

function toggleMapExpand(){
  document.body.classList.remove("map-collapsed");
  const ex=document.body.classList.toggle("map-expanded");
  document.getElementById("btn-map-exp").textContent=ex?"⤡":"⤢";
  setTimeout(()=>lmap.invalidateSize(),220);
}

// ── GPS Thông Minh ─────────────────────────────────────────
function checkSecureForGPS(){
  if(!window.isSecureContext && location.hostname!=="localhost" && location.hostname!=="127.0.0.1"){
    return "GPS chỉ hoạt động khi mở trang qua HTTPS (ví dụ GitHub Pages) hoặc localhost.";
  }
  if(!navigator.geolocation)return "Thiết bị không hỗ trợ GPS.";
  return null;
}

function getGPS(){
  return new Promise((res,rej)=>{
    const secErr=checkSecureForGPS();
    if(secErr)return rej(new Error(secErr));
    navigator.geolocation.getCurrentPosition(
      p=>res({lat:p.coords.latitude,lon:p.coords.longitude}),
      err=>rej(new Error(err.code===1?"Bạn chưa cấp quyền vị trí GPS cho trình duyệt.":err.code===3?"Hết thời gian chờ tín hiệu GPS.":"Không lấy được tín hiệu GPS.")),
      {enableHighAccuracy:true,timeout:12000,maximumAge:60000}
    );
  });
}

function updateMyPosMarker(pos,fly=false){
  st.my_pos=pos;
  if(myPosMarker)lmap.removeLayer(myPosMarker);
  myPosMarker=L.circleMarker([pos.lat,pos.lon],{radius:8,color:"#fff",weight:3,fillColor:"#2563eb",fillOpacity:1})
    .bindPopup("📍 Vị trí hiện tại của bạn").addTo(lmap);
  if(fly){lmap.flyTo([pos.lat,pos.lon],13,{duration:.6});myPosMarker.openPopup();}
}

async function smartGPSBtn(){
  const btn=document.getElementById("btn-smart-gps");
  if(st.live_watch_id!==null){
    navigator.geolocation.clearWatch(st.live_watch_id);
    st.live_watch_id=null;
    btn.classList.remove("live");
    document.getElementById("near-banner").classList.remove("show");
    toast("📍 Đã tắt theo dõi vị trí liên tục");
    return;
  }
  const secErr=checkSecureForGPS();
  if(secErr){alert(secErr);return;}
  try{
    const pos=await getGPS();
    updateMyPosMarker(pos,true);
    checkNearbyStop();
    renderUI();
    btn.classList.add("live");
    toast("📍 Đang theo dõi GPS trực tiếp (chạm lại để tắt)");
    st.live_watch_id=navigator.geolocation.watchPosition(
      p=>{
        updateMyPosMarker({lat:p.coords.latitude,lon:p.coords.longitude},false);
        checkNearbyStop();
        renderUI();
      },
      ()=>{},
      {enableHighAccuracy:true,maximumAge:15000,timeout:15000}
    );
  }catch(err){alert(err.message);}
}

function checkNearbyStop(){
  if(!st.my_pos)return;
  const bn=document.getElementById("near-banner");
  const near=st.schedule.find(s=>!getCI(s.name)&&!st.dismissed_near[s.name]&&hav(st.my_pos.lat,st.my_pos.lon,s.lat,s.lon)<0.15);
  if(!near){bn.classList.remove("show");return;}
  const meters=Math.round(hav(st.my_pos.lat,st.my_pos.lon,near.lat,near.lon)*1000);
  bn.innerHTML=`
    <span>📍 Bạn đang ở gần <strong>${escHtml(near.name)}</strong> (${meters}m)</span>
    <span style="display:flex;gap:5px;flex-shrink:0;">
      <button class="btn-mini-rep" style="background:var(--acc);color:#fff;border-color:var(--acc);" onclick="toggleCheckin(${near.stt})">✅ Check-in</button>
      <button class="btn-mini-rep" onclick="dismissNear('${escHtml(near.name).replace(/'/g,"\\'")}')">✕</button>
    </span>`;
  bn.classList.add("show");
}
function dismissNear(name){st.dismissed_near[name]=true;document.getElementById("near-banner").classList.remove("show");}

// ── Thuật toán định tuyến ──────────────────────────────────
const hav=(a,b,c,d)=>{const r=x=>x*Math.PI/180,p1=r(a),p2=r(c),dp=r(c-a),dl=r(d-b);let v=Math.sin(dp/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;return 2*EAR*Math.asin(Math.sqrt(Math.min(1,Math.max(0,v))));};
const rdist=(a,b,c,d)=>hav(a,b,c,d)*ROAD;

function nn(recs,from=null){
  if(!recs.length)return[];
  let si=0;
  if(from){let md=Infinity;recs.forEach((r,i)=>{const d=hav(from.lat,from.lon,r.lat,r.lon);if(d<md){md=d;si=i;}});}
  else recs.forEach((r,i)=>{if(r.lat>recs[si].lat)si=i;});
  const ord=[si],rem=new Set(recs.map((_,i)=>i));rem.delete(si);
  while(rem.size){const l=recs[ord[ord.length-1]];let bi=null,bd=Infinity;for(const i of rem){const d=hav(l.lat,l.lon,recs[i].lat,recs[i].lon);if(d<bd){bd=d;bi=i;}}ord.push(bi);rem.delete(bi);}
  return ord.map(i=>recs[i]);
}

function twoOptEndpoints(recs,from=null,to=null,mx=50){
  if(recs.length<2)return recs;
  const cost=(arr)=>{
    let t=0;
    if(from)t+=hav(from.lat,from.lon,arr[0].lat,arr[0].lon);
    for(let i=0;i<arr.length-1;i++)t+=hav(arr[i].lat,arr[i].lon,arr[i+1].lat,arr[i+1].lon);
    if(to)t+=hav(arr[arr.length-1].lat,arr[arr.length-1].lon,to.lat,to.lon);
    return t;
  };
  let r=[...recs],bd=cost(r);
  for(let p=0;p<mx;p++){
    let imp=false;
    for(let i=0;i<r.length-1;i++){
      for(let j=i+1;j<r.length;j++){
        const c=[...r.slice(0,i),...r.slice(i,j+1).reverse(),...r.slice(j+1)];
        const d=cost(c);
        if(d+1e-9<bd){r=c;bd=d;imp=true;}
      }
    }
    if(!imp)break;
  }
  return r;
}

function routeByProvince(shops,from=null,to=null,prioritizeDueProvs=false){
  if(!shops.length)return[];
  const provs=[...new Set(shops.map(s=>s.province))];
  const hasDueByProv=new Set(shops.filter(s=>{const vs=getVisitStatus(s);return vs&&(vs.state==="overdue"||vs.state==="due");}).map(s=>s.province));

  const pickNextProv=(candidates,lp)=>{
    if(!lp){
      return candidates.reduce((best,p)=>{
        const grp=shops.filter(s=>s.province===p);
        const maxLat=Math.max(...grp.map(x=>x.lat));
        return maxLat>best.lat?{p,lat:maxLat}:best;
      },{p:candidates[0],lat:-999}).p;
    }
    let nr=candidates[0],md=Infinity;
    for(const p of candidates){
      for(const s of shops.filter(x=>x.province===p)){
        const d=hav(lp.lat,lp.lon,s.lat,s.lon);
        if(d<md){md=d;nr=p;}
      }
    }
    return nr;
  };

  const rem=new Set(provs);
  const out=[];let lp=from;
  while(rem.size){
    let cand=[...rem];
    if(prioritizeDueProvs){
      const dueC=cand.filter(p=>hasDueByProv.has(p));
      if(dueC.length)cand=dueC;
    }
    const cur=pickNextProv(cand,lp);
    rem.delete(cur);
    const isLastProv=(rem.size===0);
    const endTarget=isLastProv?to:null;
    let g=shops.filter(s=>s.province===cur);
    if(prioritizeDueProvs){
      const dueG=g.filter(s=>{const vs=getVisitStatus(s);return vs&&(vs.state==="overdue"||vs.state==="due");});
      const normG=g.filter(s=>!dueG.includes(s));
      const ordDue=twoOptEndpoints(nn(dueG,lp),lp,normG.length?null:endTarget);
      const lastP=ordDue.length?{lat:ordDue[ordDue.length-1].lat,lon:ordDue[ordDue.length-1].lon}:lp;
      const ordNorm=twoOptEndpoints(nn(normG,lastP),lastP,endTarget);
      g=[...ordDue,...ordNorm];
    }else{
      g=twoOptEndpoints(nn(g,lp),lp,endTarget);
    }
    out.push(...g);
    const ls=g[g.length-1];lp={lat:ls.lat,lon:ls.lon};
  }
  return out;
}

function routeFarToNear(shops,fromPt=null,toPt=null,byProv=false,prioritizeDue=false){
  if(shops.length<2)return shops;
  const anchor=toPt||fromPt||shops[0];
  let far=shops[0],maxD=-1;
  shops.forEach(s=>{const d=hav(anchor.lat,anchor.lon,s.lat,s.lon);if(d>maxD){maxD=d;far=s;}});
  const rest=shops.filter(s=>s!==far);
  if(byProv){
    const ord=routeByProvince(rest,far,toPt,prioritizeDue);
    return[far,...ord];
  }
  const ord=twoOptEndpoints(nn(rest,far),far,toPt);
  return[far,...ord];
}

function nearestHotel(s,hotels){
  if(!hotels?.length)return null;
  let best=null,md=Infinity;
  for(const h of hotels){const d=rdist(s.lat,s.lon,h.lat,h.lon);if(d<md){md=d;best={...h,dist:d,type:"hotel"};}}
  return best;
}

function resolveDayEnd(day,lastShop,hotels,dayEndMap=st.day_end_points){
  const ov=dayEndMap[day];
  if(ov){
    if(ov.type==="last_shop"){
      return{name:lastShop.name,lat:lastShop.lat,lon:lastShop.lon,province:lastShop.province,dist:0,type:"last_shop"};
    }
    if(ov.lat!=null&&ov.lon!=null){
      if(ov.type==="hotel"){
        const mh=hotels.find(h=>h.name===ov.name);
        const h=mh||ov;
        return{name:h.name,lat:h.lat,lon:h.lon,province:h.province||lastShop.province,dist:rdist(lastShop.lat,lastShop.lon,h.lat,h.lon),type:"hotel"};
      }
      return{name:ov.name||"Điểm tuỳ chỉnh",lat:ov.lat,lon:ov.lon,province:ov.province||lastShop.province,dist:rdist(lastShop.lat,lastShop.lon,ov.lat,ov.lon),type:"custom"};
    }
  }
  return nearestHotel(lastShop,hotels);
}

const fmt=m=>{const v=Math.round(m);return String(Math.floor(v/60)).padStart(2,"0")+":"+String(v%60).padStart(2,"0");};

function adv(cur,travel,svcMin){
  const{ls,le}=getWorkCfg();
  let t=cur;
  if(t>=ls&&t<le)t=le;
  if(t<ls&&t+travel+svcMin>ls){const md=Math.max(0,ls-t);t=le+Math.max(0,travel-md);}
  else t+=travel;
  return{arrive:t,depart:t+svcMin};
}

function findDuplicates(shops){
  const dups=[];
  for(let i=0;i<shops.length;i++){
    for(let j=i+1;j<shops.length;j++){
      const d=hav(shops[i].lat,shops[i].lon,shops[j].lat,shops[j].lon);
      if(d<0.3)dups.push({a:shops[i].name,b:shops[j].name,km:d});
    }
  }
  st.duplicates=dups;
}

function showDuplicates(){
  if(!st.duplicates.length)return;
  const txt=st.duplicates.slice(0,15).map(x=>`• ${x.a} ↔ ${x.b} (${x.km.toFixed(2)} km)`).join("\n");
  alert(`⚠️ Phát hiện ${st.duplicates.length} cặp cửa hàng gần/trùng tọa độ (< 0.3 km):\n\n${txt}`);
}

function computeSchedule(ordered,hotels,dayEndMap=st.day_end_points,overrideMax=null,tripEnd=st.trip_end_point){
  const prof=MODES[st.mode]||MODES.xemay;
  const mx=overrideMax||st.max_shops||prof.max;
  const maxKm=st.max_km||prof.maxKm;
  const{we,svc:defSvc}=getWorkCfg();
  const wsDay1=getWorkCfg(1).ws;
  const sch=[],hbd={},dayKmOver={};
  let day=1,cnt=0,cur=wsDay1,prev=null,dayStt=0,dayKm=0;

  ordered.forEach((s,idx)=>{
    const svcMin=Number(s.svcMin)>0?Number(s.svcMin):defSvc;
    const forcedMinDay=Number(st.postponed_day[s.name])||0;
    if(idx===0){
      const sp0=dayEndMap[0];
      dayStt=1;
      if(sp0?.lat!=null&&sp0?.lon!=null){
        const d0=rdist(sp0.lat,sp0.lon,s.lat,s.lon);
        const m0=(d0/prof.spd)*60;const o0=adv(wsDay1,m0,svcMin);
        sch.push({...s,stt:1,dayStt,day,distKm:d0,arriveTime:fmt(o0.arrive),departTime:fmt(o0.depart),overtime:o0.depart>we});
        cur=o0.depart;dayKm=d0;
      }else{
        sch.push({...s,stt:1,dayStt,day,distKm:0,arriveTime:fmt(wsDay1),departTime:fmt(wsDay1+svcMin),overtime:(wsDay1+svcMin)>we});
        cur=wsDay1+svcMin;dayKm=0;
      }
      if(dayKm>maxKm)dayKmOver[day]=dayKm;
      cnt=1;prev=s;return;
    }

    const dist=rdist(prev.lat,prev.lon,s.lat,s.lon);
    const tmn=(dist/prof.spd)*60;const cand=adv(cur,tmn,svcMin);
    const needNewDay=(cnt>=mx||cand.depart>we||forcedMinDay>day||(dayKm+dist>maxKm));

    if(needNewDay){
      hbd[day]=resolveDayEnd(day,sch[sch.length-1],hotels,dayEndMap);
      const endD=(hbd[day]&&hbd[day].type!=="last_shop")?(hbd[day].dist||0):0;
      if(dayKm+endD>maxKm)dayKmOver[day]=dayKm+endD;

      day++;cnt=1;dayStt=1;
      const wsCur=getWorkCfg(day).ws;
      const sp=hbd[day-1]||sch[sch.length-1];
      const md=rdist(sp.lat,sp.lon,s.lat,s.lon);const mm=(md/prof.spd)*60;const mo=adv(wsCur,mm,svcMin);
      sch.push({...s,stt:idx+1,dayStt,day,distKm:md,arriveTime:fmt(mo.arrive),departTime:fmt(mo.depart),overtime:mo.depart>we});
      cur=mo.depart;dayKm=md;prev=s;
      if(dayKm>maxKm)dayKmOver[day]=dayKm;
    }else{
      dayStt++;
      sch.push({...s,stt:idx+1,dayStt,day,distKm:dist,arriveTime:fmt(cand.arrive),departTime:fmt(cand.depart),overtime:cand.depart>we});
      cur=cand.depart;cnt++;dayKm+=dist;prev=s;
    }
  });

  if(sch.length){
    const lastStop=sch[sch.length-1];
    if(dayEndMap[day]){
      hbd[day]=resolveDayEnd(day,lastStop,hotels,dayEndMap);
    }else if(tripEnd?.lat!=null&&tripEnd?.lon!=null){
      hbd[day]={name:tripEnd.name||"Điểm kết thúc",lat:tripEnd.lat,lon:tripEnd.lon,province:tripEnd.province||lastStop.province,dist:rdist(lastStop.lat,lastStop.lon,tripEnd.lat,tripEnd.lon),type:tripEnd.type||"custom"};
    }else{
      hbd[day]=resolveDayEnd(day,lastStop,hotels,dayEndMap);
    }
    const endD=(hbd[day]&&hbd[day].type!=="last_shop")?(hbd[day].dist||0):0;
    if(dayKm+endD>maxKm)dayKmOver[day]=dayKm+endD;
  }

  let totalKm=sch.reduce((a,x)=>a+(x.distKm||0),0);
  Object.values(hbd).forEach(h=>{if(h&&h.type!=="last_shop")totalKm+=(h.dist||0);});
  return{sch,hbd,dayKmOver,totalDays:day,totalKm};
}

function getDisplayTimesForDay(day,dayStops){
  const osrm=st.osrm_by_day[day];
  if(!osrm||!dayStops.length)return{};
  const{ws,we,svc:defSvc}=getWorkCfg(day);
  const out={};
  let cur=ws;
  dayStops.forEach((s,i)=>{
    const svcMin=Number((getShopMeta(s.name)||s).svcMin)>0?Number((getShopMeta(s.name)||s).svcMin):defSvc;
    const leg=osrm.legByStop?.[s.stt];
    if(i===0&&!leg){
      out[s.stt]={arriveTime:fmt(ws),departTime:fmt(ws+svcMin),overtime:(ws+svcMin)>we,isReal:true};
      cur=ws+svcMin;
      return;
    }
    const travel=leg?leg.min:0;
    const o=adv(cur,travel,svcMin);
    out[s.stt]={arriveTime:fmt(o.arrive),departTime:fmt(o.depart),overtime:o.depart>we,isReal:true};
    cur=o.depart;
  });
  return out;
}

function getHotelReturnInfo(day,dayStops){
  if(!dayStops.length)return null;
  const h=st.hotels_by_day[day];
  if(!h||h.type==="last_shop")return null;
  const prof=MODES[st.mode]||MODES.xemay;
  const osrm=st.osrm_by_day[day];
  const lastStop=dayStops[dayStops.length-1];
  const times=getDisplayTimesForDay(day,dayStops);
  const lastDepart=times[lastStop.stt]?.departTime||lastStop.departTime;
  const depMin=hmToMin(lastDepart,960);

  if(osrm?.hotelLeg){
    const arrMin=depMin+osrm.hotelLeg.min;
    return{km:osrm.hotelLeg.km,min:osrm.hotelLeg.min,arriveTime:fmt(arrMin),overtime:arrMin>getWorkCfg(day).we};
  }
  const dist=h.dist||0;
  const travelMin=Math.round((dist/prof.spd)*60);
  const arrMin=depMin+travelMin;
  return{km:dist,min:travelMin,arriveTime:fmt(arrMin),overtime:arrMin>getWorkCfg(day).we};
}

function getActiveShopPool(){
  let pool=(st.raw.shops.length?st.raw.shops:st.raw.precomputed).map(s=>({...s}));
  if(st.only_due){
    const due=pool.filter(s=>{const vs=getVisitStatus(s);return vs&&(vs.state==="overdue"||vs.state==="due");});
    if(due.length)pool=due;
    else{
      st.only_due=false;
      localStorage.setItem("lt_only_due","0");
      toast("ℹ️ Không có điểm đến/quá hạn, đang hiện tất cả.");
    }
  }
  return pool;
}

function buildSchedule(customOrder=null){
  const{shops,hotels,precomputed}=st.raw;
  findDuplicates(shops.length?shops:precomputed);
  if(customOrder){
    st.custom_order=customOrder.map(s=>s.name);
    localStorage.setItem("lt_order",JSON.stringify(st.custom_order));
  }
  if(!customOrder&&!st.custom_order&&!st.only_due&&precomputed?.length&&st.excel_src==="lichtrinh"){
    const dayCnt={};
    st.schedule=precomputed.map(x=>{
      dayCnt[x.day]=(dayCnt[x.day]||0)+1;
      return{...x,dayStt:dayCnt[x.day]};
    });
    st.hotels_by_day={};st.day_km_over={};
    precomputed.forEach(x=>{
      if(x.nightHotel){
        const mh=hotels.find(h=>h.name===x.nightHotel);
        st.hotels_by_day[x.day]={name:x.nightHotel,dist:x.hotelDist||0,lat:mh?.lat,lon:mh?.lon,province:mh?.province||x.province,type:"hotel"};
      }
    });
  }else{
    const pool=getActiveShopPool();
    let ordered;
    if(customOrder){
      ordered=customOrder;
    }else if(st.custom_order?.length){
      const map=new Map(pool.map(s=>[s.name,{...s}]));
      ordered=[];const used=new Set();
      st.custom_order.forEach(n=>{if(map.has(n)){ordered.push(map.get(n));used.add(n);}});
      pool.forEach(s=>{if(!used.has(s.name))ordered.push({...s});});
    }else{
      ordered=routeByProvince(pool,st.day_end_points[0]||null,st.trip_end_point||null);
    }
    const res=computeSchedule(ordered,hotels);
    st.schedule=res.sch;st.hotels_by_day=res.hbd;st.day_km_over=res.dayKmOver;
  }
  st.osrm_by_day={};
  const totalDays=st.schedule.reduce((m,s)=>Math.max(m,s.day),0);
  st.day_calendar=computeDayCalendar(totalDays,st.start_date,st.skip_off_days);
}

// ── Đọc, Xuất & Tải Mẫu Excel ──────────────────────────────
async function importExcelFile(f){
  if(!f)return;
  if(typeof XLSX==="undefined"){alert("Chưa tải được thư viện đọc Excel. Vui lòng kiểm tra kết nối mạng rồi tải lại trang.");return;}
  try{
    const buf=await f.arrayBuffer();const wb=XLSX.read(buf,{type:"array"});
    const tr=n=>wb.Sheets[n]?XLSX.utils.sheet_to_json(wb.Sheets[n],{defval:null}):[];
    const rawShops=tr("CuaHang").map(r=>({
      name:String(r["Tên cửa hàng"]||"").trim(),
      lon:parseCoord(r["kinh độ"]),lat:parseCoord(r["vĩ độ"]),
      province:String(r["tỉnh"]||"").trim(),
      address:String(r["Địa chỉ"]||"").trim(),
      freqDays:Math.max(0,parseInt(r["Tần suất (ngày)"],10)||0),
      lastVisit:r["Ghé gần nhất"]?String(r["Ghé gần nhất"]).trim().slice(0,10):"",
      svcMin:Math.max(0,parseInt(r["Thời gian ghé (phút)"],10)||0)
    })).filter(s=>s.name&&s.province&&!isNaN(s.lon)&&!isNaN(s.lat));
    const rawHotels=tr("KhachSan").map(r=>({name:String(r["Tên khách sạn"]||"").trim(),lon:parseCoord(r["kinh độ"]),lat:parseCoord(r["vĩ độ"]),province:String(r["tỉnh"]||"").trim(),address:String(r["Địa chỉ"]||"").trim()})).filter(h=>h.name&&!isNaN(h.lon)&&!isNaN(h.lat));
    const ltRows=tr("LichTrinh");
    const rawPre=ltRows.map((r,i)=>({
      stt:Number(r["STT"])||i+1,day:Number(r["Ngày"])||1,name:String(r["Tên cửa hàng"]||"").trim(),
      province:String(r["tỉnh"]||"").trim(),address:String(r["Địa chỉ"]||"").trim(),
      lon:parseCoord(r["kinh độ"]),lat:parseCoord(r["vĩ độ"]),
      distKm:parseCoord(r["Quãng đường (km)"])||0,nightHotel:r["Nghỉ đêm tại"]?String(r["Nghỉ đêm tại"]).trim():null,
      hotelDist:parseCoord(r["Cách khách sạn (km)"])||0,
      arriveTime:r["Giờ đến"]?String(r["Giờ đến"]).trim():"--:--",
      departTime:r["Giờ đi"]?String(r["Giờ đi"]).trim():"--:--",
      freqDays:Math.max(0,parseInt(r["Tần suất (ngày)"],10)||0),
      lastVisit:r["Ghé gần nhất"]?String(r["Ghé gần nhất"]).trim().slice(0,10):"",
      svcMin:Math.max(0,parseInt(r["Thời gian ghé (phút)"],10)||0),
      _ciStatus:String(r["Trạng thái Check-in"]||"").trim(),
      _ciTime:String(r["Giờ Check-in"]||"").trim(),
      _ciNote:String(r["Ghi chú"]||"").trim()
    })).filter(s=>s.name&&s.name!=="Nghỉ ngơi"&&!isNaN(s.lat)&&!isNaN(s.lon));
    if(!rawShops.length&&!rawPre.length){alert("Không đọc được dữ liệu (cần sheet CuaHang hoặc LichTrinh)!");return;}

    if(Object.keys(st.checkins).length>0){
      if(confirm("Bạn có muốn xoá trạng thái Check-in của chuyến cũ trước khi nạp file Excel mới không?\n\n• OK: Xoá cũ, giữ nguyên lịch sử ghé\n• Huỷ: Giữ lại Check-in cũ nếu trùng tên")){
        st.checkins={};
      }
    }

    const dShops=dedupeNames(rawShops);
    const dHotels=dedupeNames(rawHotels);
    const dPre=dedupeNames(rawPre);
    let shops=dShops.items;
    const hotels=dHotels.items;
    const precomputed=dPre.items.map(({_ciStatus,_ciTime,_ciNote,...rest})=>rest);

    if(!shops.length&&precomputed.length){
      shops=precomputed.map(p=>({name:p.name,lon:p.lon,lat:p.lat,province:p.province,address:p.address||"",freqDays:p.freqDays||0,lastVisit:p.lastVisit||"",svcMin:p.svcMin||0}));
      st.excel_src="lichtrinh";
    }else if(precomputed.length){
      st.excel_src=confirm("File Excel có sẵn lịch trình (sheet LichTrinh).\n\n• OK: Giữ nguyên lịch trình có sẵn trong file\n• Huỷ: Tự tính và sắp xếp lại từ danh sách CuaHang")?"lichtrinh":"optimize";
    }else{
      st.excel_src="optimize";
    }
    localStorage.setItem("lt_src",st.excel_src);

    dPre.items.forEach(r=>{
      if(r._ciStatus==="Đã ghé"||r._ciStatus==="✓"||r._ciStatus==="true"){
        st.checkins[r.name]={done:true,time:r._ciTime,note:r._ciNote};
      }
    });
    localStorage.setItem("lt_ci",JSON.stringify(st.checkins));

    st.raw={shops,hotels,precomputed};
    st.custom_order=null;
    st.day_end_points={};
    st.day_start_times={};
    st.postponed_day={};
    st.trip_end_point=null;
    st.sel_provinces=[];
    st.only_due=false;
    st.needs_reopt=false;
    ["lt_order","lt_day_ends","lt_day_starts","lt_postponed","lt_trip_end","lt_sel_provs","lt_only_due","lt_reopt"].forEach(k=>localStorage.removeItem(k));
    localStorage.setItem("lt_raw",JSON.stringify(st.raw));
    st.sel_day=1;refreshAll();
    const renamedCnt=dShops.renamed+dHotels.renamed+dPre.renamed;
    toast(`✅ Đã nạp ${shops.length||precomputed.length} điểm${renamedCnt?" (đã tự đánh số tên trùng)":""}!`);
  }catch(err){alert("Lỗi Excel: "+err.message);}
}
document.getElementById("excel-input").addEventListener("change",e=>{importExcelFile(e.target.files[0]);e.target.value="";});

function exportExcel(){
  if(typeof XLSX==="undefined"){alert("Chưa tải được thư viện xuất Excel.");return;}
  if(!st.schedule.length&&!st.raw.shops.length){alert("Chưa có dữ liệu để xuất!");return;}

  const lastIdxByDay={};
  st.schedule.forEach((s,i)=>{lastIdxByDay[s.day]=i;});

  const ltData=st.schedule.map((s,i)=>{
    const isLast=lastIdxByDay[s.day]===i;
    const h=isLast?st.hotels_by_day[s.day]:null;
    const ci=getCI(s.name);
    const meta=getShopMeta(s.name)||s;
    const cal=st.day_calendar[s.day];
    return{
      "STT":s.stt,"Thứ tự ngày":s.dayStt||"","Ngày":s.day,"Ngày lịch":cal?`${cal.weekday} ${cal.solar} (${cal.lunar})`:"","Tên cửa hàng":s.name,"Địa chỉ":meta.address||"","tỉnh":s.province,"vĩ độ":s.lat,"kinh độ":s.lon,
      "Quãng đường (km)":Number((s.distKm||0).toFixed(2)),"Giờ đến":s.arriveTime,"Giờ đi":s.departTime,
      "Nghỉ đêm tại":h?h.name:"","Cách khách sạn (km)":h?Number((h.dist||0).toFixed(2)):"",
      "Thời gian ghé (phút)":meta.svcMin||"","Tần suất (ngày)":meta.freqDays||"","Ghé gần nhất":meta.lastVisit||"",
      "Trạng thái Check-in":ci?"Đã ghé":"Chưa ghé","Giờ Check-in":ci?.time||"","Ghi chú":ci?.note||""
    };
  });
  const srcShops=st.raw.shops.length?st.raw.shops:st.schedule;
  const chData=srcShops.map(s=>({"Tên cửa hàng":s.name,"Địa chỉ":s.address||"","tỉnh":s.province,"vĩ độ":s.lat,"kinh độ":s.lon,"Thời gian ghé (phút)":s.svcMin||"","Tần suất (ngày)":s.freqDays||"","Ghé gần nhất":s.lastVisit||""}));
  const ksData=st.raw.hotels.map(h=>({"Tên khách sạn":h.name,"Địa chỉ":h.address||"","tỉnh":h.province,"vĩ độ":h.lat,"kinh độ":h.lon}));

  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(ltData),"LichTrinh");
  XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(chData),"CuaHang");
  XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(ksData),"KhachSan");
  XLSX.writeFile(wb,`LoTrinh_KinhDoanh_${toLocalIso()}.xlsx`);
  toast("📤 Đã xuất file Excel!");
}

function downloadSampleExcel(){
  if(typeof XLSX==="undefined"){alert("Chưa tải được thư viện Excel.");return;}
  const ch=[
    {"Tên cửa hàng":"CH Hội An Center","Địa chỉ":"Trần Hưng Đạo, Hội An","tỉnh":"Quảng Nam","vĩ độ":15.880,"kinh độ":108.338,"Thời gian ghé (phút)":30,"Tần suất (ngày)":7,"Ghé gần nhất":""},
    {"Tên cửa hàng":"CH Tam Kỳ 1","Địa chỉ":"Phan Châu Trinh, Tam Kỳ","tỉnh":"Quảng Nam","vĩ độ":15.573,"kinh độ":108.474,"Thời gian ghé (phút)":45,"Tần suất (ngày)":14,"Ghé gần nhất":""},
    {"Tên cửa hàng":"CH TP Kon Tum","Địa chỉ":"Trần Phú, TP Kon Tum","tỉnh":"Kon Tum","vĩ độ":14.349,"kinh độ":108.007,"Thời gian ghé (phút)":30,"Tần suất (ngày)":30,"Ghé gần nhất":""}
  ];
  const ks=[
    {"Tên khách sạn":"KS Mường Thanh QNam","Địa chỉ":"Hùng Vương, Tam Kỳ","tỉnh":"Quảng Nam","vĩ độ":15.565,"kinh độ":108.481}
  ];
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(ch),"CuaHang");
  XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(ks),"KhachSan");
  XLSX.writeFile(wb,"Mau_Data_LoTrinh.xlsx");
  toast("📋 Đã tải file Excel mẫu!");
}

// ── Dán Link Google Maps / Tọa độ & Tự lấy địa chỉ ───────────
function onPasteCoords(prefix){
  const inp=document.getElementById(`${prefix}-link`);
  const msg=document.getElementById(`${prefix}-link-msg`);
  const res=parseMapsLinkOrCoords(inp.value);
  if(!res){msg.textContent="";return;}
  if(res.shortLink){
    msg.style.color="var(--warn)";
    msg.textContent="⚠️ Link rút gọn maps.app.goo.gl cần mở trên Google Maps rồi copy tọa độ (15.880, 108.338) dán vào đây.";
    return;
  }
  msg.style.color="var(--acc)";
  msg.textContent=`✅ Đã nhận tọa độ: ${res.lat.toFixed(6)}, ${res.lon.toFixed(6)}`;
  if(prefix==="pt")setMiniPin(res.lat,res.lon,true);
  else setDeMiniPin(res.lat,res.lon);
}

async function autoFillAddress(lat,lon,forceFill=false){
  const geoMsg=document.getElementById("pt-geo-msg");
  const addrInp=document.getElementById("pt-address");
  const provInp=document.getElementById("pt-province");
  if(geoMsg)geoMsg.textContent="⏳ Đang tìm địa chỉ thực tế...";
  const info=await fetchAddressByCoords(lat,lon);
  if(info){
    if(info.address&&(forceFill||!addrInp.value.trim()))addrInp.value=info.address;
    if(info.province&&(forceFill||!provInp.value.trim()))provInp.value=info.province;
    if(geoMsg)geoMsg.textContent=info.address?`🏠 ${info.address}${info.province?` · ${info.province}`:""}`:"";
  }else if(geoMsg){
    geoMsg.textContent="";
  }
}

// ── THÊM / SỬA / XOÁ ĐIỂM & KÉO THẢ ─────────────────────────
let ptType="shop",editTarget=null,miniMap=null,miniMarker=null,suggestHits=[];

function toggleEditMode(){
  st.edit_mode=!st.edit_mode;
  document.getElementById("btn-edit-mode").classList.toggle("active",st.edit_mode);
  toast(st.edit_mode?"⇅ Kéo giữ ⋮⋮ để đổi thứ tự hoặc bấm ✏️ để sửa":"✅ Đã tắt chế độ Sắp xếp");
  renderUI();
}

function setPointType(t){
  ptType=t;
  document.getElementById("pt-type-shop").classList.toggle("active",t==="shop");
  document.getElementById("pt-type-hotel").classList.toggle("active",t==="hotel");
  document.getElementById("pt-visit-row").style.display=t==="shop"?"flex":"none";
  document.getElementById("pt-svc-wrap").style.display=t==="shop"?"block":"none";
  document.getElementById("pt-dlg-title").textContent=editTarget?(t==="shop"?"✏️ Sửa Cửa Hàng":"✏️ Sửa Khách Sạn"):(t==="shop"?"➕ Thêm Cửa Hàng":"🏨 Thêm Khách Sạn");
  document.getElementById("pt-suggest").style.display="none";
}

function syncMiniMap(cLat,cLon,zoom,hasPin){
  if(!miniMap){
    miniMap=L.map("add-mini-map",{zoomControl:false}).setView([cLat,cLon],zoom);
    L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",{maxZoom:19}).addTo(miniMap);
    miniMap.on("click",e=>setMiniPin(e.latlng.lat,e.latlng.lng,true));
  }
  const refresh=()=>{
    if(!miniMap)return;
    miniMap.invalidateSize();
    miniMap.setView([cLat,cLon],zoom,{animate:false});
    if(miniMarker){miniMap.removeLayer(miniMarker);miniMarker=null;}
    if(hasPin)miniMarker=L.marker([cLat,cLon]).addTo(miniMap);
  };
  setTimeout(refresh,120);
  setTimeout(()=>miniMap&&miniMap.invalidateSize(),380);
}

function openPointDialog(type,editItem=null){
  editTarget=editItem?{type,name:editItem.name}:null;
  document.getElementById("pt-type-wrap").style.display=editItem?"none":"block";
  setPointType(type);
  document.getElementById("pt-name").value=editItem?editItem.name:"";
  document.getElementById("pt-address").value=editItem?.address||"";
  document.getElementById("pt-geo-msg").textContent="";
  document.getElementById("pt-province").value=editItem?editItem.province:"";
  document.getElementById("pt-lat").value=editItem?editItem.lat:"";
  document.getElementById("pt-lon").value=editItem?editItem.lon:"";
  document.getElementById("pt-freq").value=editItem?.freqDays?editItem.freqDays:"";
  document.getElementById("pt-last-visit").value=editItem?.lastVisit||"";
  document.getElementById("pt-svc").value=editItem?.svcMin?editItem.svcMin:"";
  document.getElementById("pt-link").value="";
  document.getElementById("pt-link-msg").textContent="";
  document.getElementById("pt-suggest").style.display="none";
  document.getElementById("pt-save-btn").textContent=editItem?"💾 Lưu thay đổi":"✅ Thêm vào danh sách";
  document.getElementById("pt-del-btn").style.display=editItem?"inline-block":"none";

  const moveRow=document.getElementById("pt-move-row");
  const moveSel=document.getElementById("pt-move-pos");
  if(editItem&&type==="shop"&&st.schedule.some(s=>s.name===editItem.name)){
    moveRow.style.display="block";
    let opts=`<option value="">-- Giữ nguyên vị trí hiện tại --</option><option value="0">⬆️ Đưa lên đầu tiên (#1)</option>`;
    st.schedule.forEach((s,i)=>{
      if(s.name!==editItem.name){
        opts+=`<option value="${i+1}">Sau N${s.day}·#${s.dayStt} ${escHtml(s.name)}</option>`;
      }
    });
    moveSel.innerHTML=opts;
  }else{
    moveRow.style.display="none";
    moveSel.innerHTML="";
  }

  openDlg("point-dialog");

  const hasPin=Boolean(editItem?.lat!=null&&editItem?.lon!=null);
  syncMiniMap(hasPin?editItem.lat:15,hasPin?editItem.lon:108.4,hasPin?13:7,hasPin);
}

function setMiniPin(lat,lon,lookupAddr=false){
  document.getElementById("pt-lat").value=Number(lat).toFixed(6);
  document.getElementById("pt-lon").value=Number(lon).toFixed(6);
  if(miniMap){
    if(miniMarker)miniMap.removeLayer(miniMarker);
    miniMarker=L.marker([lat,lon]).addTo(miniMap);
    miniMap.setView([lat,lon],Math.max(miniMap.getZoom(),13),{animate:false});
  }
  if(lookupAddr)autoFillAddress(lat,lon,!editTarget);
}

async function fillPointGPS(){
  const btn=document.getElementById("btn-pt-gps");
  const old=btn.textContent;btn.textContent="⏳ Đang lấy GPS...";btn.disabled=true;
  try{
    const pos=await getGPS();
    st.my_pos=pos;
    setMiniPin(pos.lat,pos.lon,true);
    toast("📍 Đã lấy tọa độ GPS & đang tìm địa chỉ");
  }catch(err){alert(err.message);}
  finally{btn.textContent=old;btn.disabled=false;}
}

function onPointNameInput(){
  if(editTarget)return;
  const q=normVN(document.getElementById("pt-name").value);
  const sb=document.getElementById("pt-suggest");
  if(q.length<2){sb.style.display="none";return;}
  const pool=ptType==="shop"?st.raw.shops:st.raw.hotels;
  suggestHits=pool.filter(x=>normVN(x.name).includes(q)).slice(0,6);
  if(!suggestHits.length){sb.style.display="none";return;}
  sb.innerHTML=suggestHits.map((x,i)=>`<div class="suggest-item" onclick="pickSuggest(${i})">📍 ${escHtml(x.name)} <span style="color:var(--muted);font-size:11px;">— ${escHtml(x.province)}</span></div>`).join("");
  sb.style.display="block";
}

function pickSuggest(idx){
  const x=suggestHits[idx];if(!x)return;
  document.getElementById("pt-name").value=x.name;
  document.getElementById("pt-address").value=x.address||"";
  document.getElementById("pt-province").value=x.province;
  setMiniPin(x.lat,x.lon,false);
  document.getElementById("pt-suggest").style.display="none";
}

function savePoint(){
  const name=document.getElementById("pt-name").value.trim();
  const address=document.getElementById("pt-address").value.trim();
  const prov=document.getElementById("pt-province").value.trim();
  const lat=parseCoord(document.getElementById("pt-lat").value);
  const lon=parseCoord(document.getElementById("pt-lon").value);
  const freqDays=Math.max(0,parseInt(document.getElementById("pt-freq").value,10)||0);
  const lastVisit=document.getElementById("pt-last-visit").value.trim();
  const svcMin=Math.max(0,parseInt(document.getElementById("pt-svc").value,10)||0);
  if(!name){alert("Vui lòng nhập tên!");return;}
  if(!prov){alert("Vui lòng nhập tỉnh!");return;}
  if(isNaN(lat)||isNaN(lon)){alert("Vui lòng chọn vị trí trên bản đồ, bấm GPS hoặc nhập tọa độ hợp lệ!");return;}

  const list=ptType==="shop"?st.raw.shops:st.raw.hotels;
  const payload=ptType==="shop"?{name,address,lat,lon,province:prov,freqDays,lastVisit,svcMin}:{name,address,lat,lon,province:prov};

  if(editTarget){
    const idx=list.findIndex(x=>x.name===editTarget.name);
    if(idx===-1){alert("Không tìm thấy mục cần sửa!");return;}
    if(name!==editTarget.name&&list.some(x=>x.name===name)){alert("Tên mới bị trùng với mục khác!");return;}
    list[idx]=payload;
    if(ptType==="shop"&&name!==editTarget.name){
      if(st.checkins[editTarget.name]){st.checkins[name]=st.checkins[editTarget.name];delete st.checkins[editTarget.name];localStorage.setItem("lt_ci",JSON.stringify(st.checkins));}
      if(st.visit_history[editTarget.name]){st.visit_history[name]=st.visit_history[editTarget.name];delete st.visit_history[editTarget.name];localStorage.setItem("lt_history",JSON.stringify(st.visit_history));}
      if(st.custom_order){st.custom_order=st.custom_order.map(n=>n===editTarget.name?name:n);localStorage.setItem("lt_order",JSON.stringify(st.custom_order));}
    }
    const moveVal=document.getElementById("pt-move-pos").value;
    if(ptType==="shop"&&moveVal!==""){
      const targetPos=parseInt(moveVal,10);
      const names=st.schedule.map(s=>s.name===editTarget.name?name:s.name);
      const curIdx=names.indexOf(name);
      if(curIdx>=0){
        names.splice(curIdx,1);
        const insIdx=targetPos>curIdx?targetPos-1:targetPos;
        names.splice(Math.max(0,Math.min(names.length,insIdx)),0,name);
        st.custom_order=names;
        localStorage.setItem("lt_order",JSON.stringify(st.custom_order));
      }
    }
    toast(`💾 Đã cập nhật "${name}"`);
  }else{
    if(list.some(x=>x.name===name)){alert((ptType==="shop"?"Cửa hàng":"Khách sạn")+" đã tồn tại!");return;}
    list.push(payload);
    if(ptType==="shop"&&st.custom_order){st.custom_order.push(name);localStorage.setItem("lt_order",JSON.stringify(st.custom_order));}
    toast(`✅ Đã thêm "${name}"`);
  }

  if(ptType==="shop"){st.needs_reopt=true;localStorage.setItem("lt_reopt","1");}
  st.excel_src="optimize";
  localStorage.setItem("lt_src","optimize");
  localStorage.setItem("lt_raw",JSON.stringify(st.raw));
  closeDlg("point-dialog");
  refreshAll();
}

function deleteEditingPoint(){
  if(!editTarget||!confirm(`Xoá "${editTarget.name}" khỏi danh sách?`))return;
  if(editTarget.type==="shop"){
    st.raw.shops=st.raw.shops.filter(s=>s.name!==editTarget.name);
    st.raw.precomputed=st.raw.precomputed.filter(s=>s.name!==editTarget.name);
    if(st.custom_order){st.custom_order=st.custom_order.filter(n=>n!==editTarget.name);localStorage.setItem("lt_order",JSON.stringify(st.custom_order));}
    st.excel_src="optimize";localStorage.setItem("lt_src","optimize");
    st.needs_reopt=true;localStorage.setItem("lt_reopt","1");
  }else{
    st.raw.hotels=st.raw.hotels.filter(h=>h.name!==editTarget.name);
  }
  localStorage.setItem("lt_raw",JSON.stringify(st.raw));
  closeDlg("point-dialog");
  st.sel_day=1;refreshAll();
  toast(`🗑️ Đã xoá "${editTarget.name}"`);
}

function reorderByStt(fromStt,toStt){
  const fromIdx=st.schedule.findIndex(s=>s.stt===fromStt);
  const toIdx=st.schedule.findIndex(s=>s.stt===toStt);
  if(fromIdx<0||toIdx<0||fromIdx===toIdx)return;
  const movedName=st.schedule[fromIdx].name;
  const oldDay=st.schedule[fromIdx].day;
  const names=st.schedule.map(s=>s.name);
  names.splice(fromIdx,1);
  names.splice(toIdx,0,movedName);
  const pool=getActiveShopPool();
  const map=new Map(pool.map(s=>[s.name,{...s}]));
  const ordered=names.map(n=>map.get(n)).filter(Boolean);
  if(!ordered.length)return;
  st.excel_src="optimize";localStorage.setItem("lt_src","optimize");
  buildSchedule(ordered);
  const movedStop=st.schedule.find(s=>s.name===movedName);
  if(movedStop&&st.sel_day!==0&&movedStop.day!==oldDay){
    st.sel_day=movedStop.day;
    toast(`📅 "${movedName}" đã chuyển sang Ngày ${movedStop.day}`);
  }else{
    toast(`⇅ Đã đổi vị trí "${movedName}"`);
  }
  renderUI();renderMap();loadDayExtras();
}

function moveStop(stt,dir){
  const idx=st.schedule.findIndex(s=>s.stt===stt);
  const target=idx+dir;
  if(idx<0||target<0||target>=st.schedule.length)return;
  reorderByStt(stt,st.schedule[target].stt);
}

// Kéo-giữ bằng tay cầm ⋮⋮
let dragState=null;
const listEl=document.getElementById("schedule-list");
listEl.addEventListener("pointerdown",e=>{
  const handle=e.target.closest(".drag-handle");
  if(!handle)return;
  const card=handle.closest(".shop-card[data-stt]");
  if(!card)return;
  e.preventDefault();
  dragState={fromStt:Number(card.dataset.stt),overStt:null,card};
  card.classList.add("dragging");
  try{handle.setPointerCapture(e.pointerId);}catch{}
});

listEl.addEventListener("pointermove",e=>{
  if(!dragState)return;
  e.preventDefault();
  const el=document.elementFromPoint(e.clientX,e.clientY);
  const targetCard=el?el.closest(".shop-card[data-stt]"):null;
  listEl.querySelectorAll(".shop-card.drag-over").forEach(c=>c.classList.remove("drag-over"));
  if(targetCard&&Number(targetCard.dataset.stt)!==dragState.fromStt){
    targetCard.classList.add("drag-over");
    dragState.overStt=Number(targetCard.dataset.stt);
  }else{
    dragState.overStt=null;
  }
});

function finishDrag(){
  if(!dragState)return;
  const{fromStt,overStt,card}=dragState;
  card.classList.remove("dragging");
  listEl.querySelectorAll(".shop-card.drag-over").forEach(c=>c.classList.remove("drag-over"));
  dragState=null;
  if(overStt&&overStt!==fromStt)reorderByStt(fromStt,overStt);
}
listEl.addEventListener("pointerup",finishDrag);
listEl.addEventListener("pointercancel",finishDrag);

// ── GIỜ KHỞI HÀNH RIÊNG & ĐỔI ĐIỂM CUỐI NGÀY ────────────────
function onDayStartTimeChange(day,val){
  if(!val)return;
  st.day_start_times[day]=val;
  localStorage.setItem("lt_day_starts",JSON.stringify(st.day_start_times));
  st.excel_src="optimize";
  localStorage.setItem("lt_src","optimize");
  refreshAll();
  toast(`⏰ Đã đặt giờ khởi hành Ngày ${day}: ${val}`);
}

let deTargetDay=1,deMiniMap=null,deMiniMarker=null;

function openDayEndDialog(day){
  deTargetDay=day;
  const isDay1Start=(day===0);
  document.getElementById("de-dlg-title").textContent=isDay1Start?"🚩 Điểm xuất phát Ngày 1":`📍 Điểm cuối Ngày ${day} → Bắt đầu Ngày ${day+1}`;
  document.getElementById("de-desc").textContent=isDay1Start?"Chọn điểm xuất phát cho buổi sáng Ngày 1 (mặc định tại điểm #1).":`Chọn điểm nghỉ đêm / kết thúc Ngày ${day}. Sáng Ngày ${day+1} sẽ xuất phát từ điểm này.`;

  const modeSel=document.getElementById("de-mode");
  if(isDay1Start){
    modeSel.innerHTML=`
      <option value="default">Mặc định (bắt đầu ngay tại điểm #1)</option>
      <option value="hotel">Xuất phát từ một Khách sạn</option>
      <option value="custom">Điểm tuỳ chỉnh (Link Maps / GPS / Bản đồ)</option>`;
  }else{
    modeSel.innerHTML=`
      <option value="default">Mặc định (Khách sạn gần điểm cuối nhất)</option>
      <option value="last_shop">Ngay tại cửa hàng cuối cùng của Ngày ${day}</option>
      <option value="hotel">Chọn Khách sạn khác trong danh sách</option>
      <option value="custom">Thêm / Chọn điểm tuỳ chỉnh mới</option>`;
  }

  const hSel=document.getElementById("de-hotel");
  hSel.innerHTML=st.raw.hotels.length
    ? st.raw.hotels.map(h=>`<option value="${escHtml(h.name)}">${escHtml(h.name)} (${escHtml(h.province)})</option>`).join("")
    : `<option value="">-- Chưa có khách sạn nào --</option>`;

  const cur=st.day_end_points[day];
  const dayStops=st.schedule.filter(s=>s.day===(isDay1Start?1:day));
  const refPt=isDay1Start?(cur?.lat!=null?cur:dayStops[0]):(cur?.lat!=null?cur:(st.hotels_by_day[day]?.lat!=null?st.hotels_by_day[day]:dayStops[dayStops.length-1]));

  document.getElementById("de-link").value="";
  document.getElementById("de-link-msg").textContent="";
  if(cur){
    modeSel.value=cur.type||"custom";
    if(cur.type==="hotel"&&cur.name)hSel.value=cur.name;
    if(cur.type==="custom"){
      document.getElementById("de-name").value=cur.name||"";
      document.getElementById("de-lat").value=cur.lat??"";
      document.getElementById("de-lon").value=cur.lon??"";
    }else{
      document.getElementById("de-name").value="";
      document.getElementById("de-lat").value=refPt?.lat!=null?Number(refPt.lat).toFixed(6):"";
      document.getElementById("de-lon").value=refPt?.lon!=null?Number(refPt.lon).toFixed(6):"";
    }
  }else{
    modeSel.value="default";
    document.getElementById("de-name").value="";
    document.getElementById("de-lat").value=refPt?.lat!=null?Number(refPt.lat).toFixed(6):"";
    document.getElementById("de-lon").value=refPt?.lon!=null?Number(refPt.lon).toFixed(6):"";
  }
  document.getElementById("de-save-hotel").checked=false;
  openDlg("day-end-dialog");
  onDayEndModeChange();
}

function onDayEndModeChange(){
  const m=document.getElementById("de-mode").value;
  document.getElementById("de-hotel-wrap").style.display=m==="hotel"?"block":"none";
  document.getElementById("de-custom-wrap").style.display=m==="custom"?"block":"none";
  if(m==="custom"){
    const latVal=parseCoord(document.getElementById("de-lat").value);
    const lonVal=parseCoord(document.getElementById("de-lon").value);
    const hasPin=!isNaN(latVal)&&!isNaN(lonVal);
    const lat=hasPin?latVal:15,lon=hasPin?lonVal:108.4,zoom=hasPin?13:7;
    if(!deMiniMap){
      deMiniMap=L.map("de-mini-map",{zoomControl:false}).setView([lat,lon],zoom);
      L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",{maxZoom:19}).addTo(deMiniMap);
      deMiniMap.on("click",e=>setDeMiniPin(e.latlng.lat,e.latlng.lng));
    }
    const refresh=()=>{
      if(!deMiniMap)return;
      deMiniMap.invalidateSize();
      deMiniMap.setView([lat,lon],zoom,{animate:false});
      if(deMiniMarker){deMiniMap.removeLayer(deMiniMarker);deMiniMarker=null;}
      if(hasPin)deMiniMarker=L.marker([lat,lon]).addTo(deMiniMap);
    };
    setTimeout(refresh,120);
    setTimeout(()=>deMiniMap&&deMiniMap.invalidateSize(),380);
  }
}

function setDeMiniPin(lat,lon){
  document.getElementById("de-lat").value=Number(lat).toFixed(6);
  document.getElementById("de-lon").value=Number(lon).toFixed(6);
  if(deMiniMap){
    if(deMiniMarker)deMiniMap.removeLayer(deMiniMarker);
    deMiniMarker=L.marker([lat,lon]).addTo(deMiniMap);
    deMiniMap.setView([lat,lon],Math.max(deMiniMap.getZoom(),13),{animate:false});
  }
}

async function fillDayEndGPS(){
  const btn=document.getElementById("btn-de-gps");
  const old=btn.textContent;btn.textContent="⏳ Đang lấy GPS...";btn.disabled=true;
  try{
    const pos=await getGPS();
    st.my_pos=pos;
    setDeMiniPin(pos.lat,pos.lon);
    if(!document.getElementById("de-name").value.trim()){
      document.getElementById("de-name").value="Vị trí GPS";
    }
    toast("📍 Đã lấy tọa độ GPS hiện tại");
  }catch(err){alert(err.message);}
  finally{btn.textContent=old;btn.disabled=false;}
}

async function saveDayEnd(){
  const m=document.getElementById("de-mode").value;
  if(m==="default"){
    delete st.day_end_points[deTargetDay];
  }else if(m==="last_shop"){
    st.day_end_points[deTargetDay]={type:"last_shop"};
  }else if(m==="hotel"){
    const hn=document.getElementById("de-hotel").value;
    const h=st.raw.hotels.find(x=>x.name===hn);
    if(!h){alert("Vui lòng chọn một khách sạn hợp lệ!");return;}
    st.day_end_points[deTargetDay]={type:"hotel",name:h.name,lat:h.lat,lon:h.lon,province:h.province};
  }else if(m==="custom"){
    const name=document.getElementById("de-name").value.trim()||"Điểm nghỉ tuỳ chỉnh";
    const lat=parseCoord(document.getElementById("de-lat").value);
    const lon=parseCoord(document.getElementById("de-lon").value);
    if(isNaN(lat)||isNaN(lon)){alert("Vui lòng chọn toạ độ trên bản đồ, bấm GPS hoặc nhập toạ độ hợp lệ!");return;}
    st.day_end_points[deTargetDay]={type:"custom",name,lat,lon};
    if(document.getElementById("de-save-hotel").checked&&!st.raw.hotels.some(h=>h.name===name)){
      const info=await fetchAddressByCoords(lat,lon);
      st.raw.hotels.push({name,address:info?.address||"",lat,lon,province:info?.province||"Khác"});
      localStorage.setItem("lt_raw",JSON.stringify(st.raw));
    }
  }
  localStorage.setItem("lt_day_ends",JSON.stringify(st.day_end_points));
  st.excel_src="optimize";
  localStorage.setItem("lt_src","optimize");
  closeDlg("day-end-dialog");
  refreshAll();
  toast(deTargetDay===0?"🚩 Đã cập nhật điểm xuất phát Ngày 1":`📍 Đã cập nhật điểm cuối Ngày ${deTargetDay}`);
}

// ── QUẢN LÝ KHÁCH SẠN ──────────────────────────────────────
function openHotelsManager(){
  renderHotelsManager();
  openDlg("hotels-dialog");
}

function renderHotelsManager(){
  const el=document.getElementById("hotels-list-body");
  if(!st.raw.hotels.length){
    el.innerHTML=`<div style="text-align:center;padding:24px;color:var(--muted);">Chưa có khách sạn nào.</div>`;
    return;
  }
  el.innerHTML=st.raw.hotels.map((h,i)=>`
    <div class="hotel-row">
      <div>
        <strong style="font-size:13.5px;">🏨 ${escHtml(h.name)}</strong>
        <div style="font-size:12px;color:var(--muted);">${escHtml(h.province)}${h.address?` · ${escHtml(h.address)}`:""}</div>
      </div>
      <div style="display:flex;gap:5px;">
        <button class="btn-sm compact" onclick="editHotel(${i})">✏️</button>
        <button class="btn-sm compact red" onclick="deleteHotel(${i})">🗑️</button>
      </div>
    </div>`).join("");
}

function editHotel(idx){
  const h=st.raw.hotels[idx];if(!h)return;
  closeDlg("hotels-dialog");
  openPointDialog("hotel",h);
}

function deleteHotel(idx){
  const h=st.raw.hotels[idx];if(!h||!confirm(`Xoá khách sạn "${h.name}"?`))return;
  st.raw.hotels.splice(idx,1);
  localStorage.setItem("lt_raw",JSON.stringify(st.raw));
  renderHotelsManager();
  refreshAll();
  toast(`🗑️ Đã xoá "${h.name}"`);
}

// ── CHECK-IN, DỜI NGÀY MAI & LỊCH SỬ GHÉ ───────────────────
let noteShopName=null,noteShopDay=1;

function recordVisitHistory(name,date,time,note){
  if(!st.visit_history[name])st.visit_history[name]=[];
  const arr=st.visit_history[name];
  const idx=arr.findIndex(x=>x.date===date);
  const entry={date,time:time||nowHHMM(),note:note||""};
  if(idx>=0)arr[idx]=entry;
  else arr.unshift(entry);
  if(arr.length>20)arr.length=20;
  localStorage.setItem("lt_history",JSON.stringify(st.visit_history));
}

function removeTodayHistory(name,date){
  if(!st.visit_history[name])return;
  st.visit_history[name]=st.visit_history[name].filter(x=>x.date!==date);
  if(!st.visit_history[name].length)delete st.visit_history[name];
  localStorage.setItem("lt_history",JSON.stringify(st.visit_history));
}

function syncLastVisitOnCheckin(name,isDone){
  const shop=getShopMeta(name);if(!shop)return;
  if(isDone){
    const prev=shop.lastVisit||"";
    if(st.checkins[name])st.checkins[name].prevLastVisit=prev;
    shop.lastVisit=toLocalIso();
  }else{
    const ci=st.checkins[name];
    if(ci&&ci.prevLastVisit!==undefined)shop.lastVisit=ci.prevLastVisit;
  }
  localStorage.setItem("lt_raw",JSON.stringify(st.raw));
}

function toggleCheckin(stt){
  const s=st.schedule.find(x=>x.stt===stt);if(!s)return;
  const today=toLocalIso();
  if(getCI(s.name)){
    syncLastVisitOnCheckin(s.name,false);
    removeTodayHistory(s.name,st.checkins[s.name]?.date||today);
    delete st.checkins[s.name];
    toast(`⬜ Bỏ Check-in: ${s.name}`);
  }else{
    const t=nowHHMM();
    st.checkins[s.name]={done:true,time:t,date:today,note:""};
    syncLastVisitOnCheckin(s.name,true);
    recordVisitHistory(s.name,today,t,"");
    toast(`✅ Đã Check-in ${s.name} (${t})`);
  }
  localStorage.setItem("lt_ci",JSON.stringify(st.checkins));
  checkNearbyStop();
  renderUI();renderMap();
}

function openNoteDialog(stt){
  const s=st.schedule.find(x=>x.stt===stt);if(!s)return;
  noteShopName=s.name;
  noteShopDay=s.day;
  const ci=getCI(s.name);
  document.getElementById("note-shop-name").textContent=s.name;
  document.getElementById("note-shop-time").textContent=ci?.time?`Đã check-in lúc ${ci.time}`:"Sẽ tự động đánh dấu Check-in khi lưu";
  document.getElementById("note-text").value=ci?.note||"";
  document.getElementById("note-postpone-btn").style.display="block";

  const hist=(st.visit_history[s.name]||[]).filter(h=>!(ci&&h.date===(ci.date||toLocalIso())));
  const hbox=document.getElementById("note-history-box");
  if(hist.length){
    hbox.innerHTML=`<div class="hist-list"><div style="font-size:12px;font-weight:700;color:var(--muted);margin-bottom:6px;">📜 Lịch sử các lần ghé trước (${hist.length})</div>`
      +hist.slice(0,6).map(h=>`<div class="hist-item"><strong>${escHtml(h.date)}</strong> ${h.time?`(${escHtml(h.time)})`:""}${h.note?`<br/>📝 ${escHtml(h.note)}`:" — Đã ghé"}</div>`).join("")
      +`</div>`;
  }else{
    hbox.innerHTML="";
  }
  openDlg("note-dialog");
}

function saveNote(){
  if(!noteShopName)return;
  const today=toLocalIso();
  const existing=getCI(noteShopName);
  const note=document.getElementById("note-text").value.trim();
  const prevLV=existing?.prevLastVisit!==undefined?existing.prevLastVisit:(getShopMeta(noteShopName)?.lastVisit||"");
  const time=existing?.time||nowHHMM();
  const date=existing?.date||today;
  st.checkins[noteShopName]={done:true,time,date,note,prevLastVisit:prevLV};
  if(!existing)syncLastVisitOnCheckin(noteShopName,true);
  recordVisitHistory(noteShopName,date,time,note);
  localStorage.setItem("lt_ci",JSON.stringify(st.checkins));
  closeDlg("note-dialog");
  checkNearbyStop();
  renderUI();renderMap();
  toast("📝 Đã lưu ghi chú!");
}

function postponeShopToNextDay(){
  if(!noteShopName)return;
  const targetDay=noteShopDay+1;
  st.postponed_day[noteShopName]=targetDay;
  localStorage.setItem("lt_postponed",JSON.stringify(st.postponed_day));

  const names=st.schedule.map(s=>s.name);
  const curIdx=names.indexOf(noteShopName);
  const nextDayFirstIdx=st.schedule.findIndex(s=>s.day===targetDay);
  if(curIdx>=0){
    names.splice(curIdx,1);
    if(nextDayFirstIdx>=0){
      const ins=nextDayFirstIdx>curIdx?nextDayFirstIdx-1:nextDayFirstIdx;
      names.splice(ins,0,noteShopName);
    }else{
      names.push(noteShopName);
    }
    const pool=getActiveShopPool();
    const map=new Map(pool.map(s=>[s.name,{...s}]));
    const ordered=names.map(n=>map.get(n)).filter(Boolean);
    st.excel_src="optimize";localStorage.setItem("lt_src","optimize");
    buildSchedule(ordered);
  }
  closeDlg("note-dialog");
  renderUI();renderMap();loadDayExtras();
  toast(`📅 Đã dời "${noteShopName}" sang Ngày ${targetDay}`);
}

function uncheckFromNote(){
  if(!noteShopName)return;
  syncLastVisitOnCheckin(noteShopName,false);
  removeTodayHistory(noteShopName,st.checkins[noteShopName]?.date||toLocalIso());
  delete st.checkins[noteShopName];
  localStorage.setItem("lt_ci",JSON.stringify(st.checkins));
  closeDlg("note-dialog");
  checkNearbyStop();
  renderUI();renderMap();
  toast("⬜ Đã huỷ Check-in");
}

// ── TỐI ƯU & SO SÁNH 3 PHƯƠNG ÁN + KHU VỰC TỈNH ───────────
let optCandidates=[];

function openOptimize(){
  const sSel=document.getElementById("opt-start");
  sSel.innerHTML='<option value="">-- Mặc định (Điểm đầu DS) --</option><option value="__GPS__">📍 Vị trí GPS hiện tại</option>';
  st.raw.hotels.forEach(h=>{sSel.innerHTML+=`<option value="${escHtml(h.name)}">${escHtml(h.name)} (KS)</option>`;});

  const eSel=document.getElementById("opt-end");
  eSel.innerHTML='<option value="">-- Tự do (Không cố định) --</option><option value="__SAME__">🔁 Quay về lại điểm xuất phát</option><option value="__GPS__">📍 Vị trí GPS hiện tại</option>';
  st.raw.hotels.forEach(h=>{eSel.innerHTML+=`<option value="${escHtml(h.name)}">${escHtml(h.name)} (KS)</option>`;});

  const provs=getAllProvinces();
  const areaWrap=document.getElementById("opt-area-wrap");
  const areaChips=document.getElementById("opt-area-chips");
  if(provs.length>1){
    areaWrap.style.display="block";
    areaChips.innerHTML=provs.map(p=>{
      const chk=st.sel_provinces.length===0||st.sel_provinces.includes(p);
      return`<label class="area-chip${chk?" chk":""}">
        <input type="checkbox" value="${escHtml(p)}" ${chk?"checked":""} onchange="this.closest('.area-chip').classList.toggle('chk',this.checked)"/>
        ${escHtml(p)}
      </label>`;
    }).join("");
  }else{
    areaWrap.style.display="none";
    areaChips.innerHTML="";
  }

  document.getElementById("opt-target-days").value="0";
  document.getElementById("opt-dir").value="normal";
  document.getElementById("opt-only-due").checked=st.only_due;
  document.getElementById("opt-compare-wrap").style.display="none";
  document.getElementById("opt-info").innerHTML=`Chọn điểm xuất phát, điểm kết thúc & khu vực (giới hạn <strong>${st.max_km} km/ngày</strong>).`;
  document.getElementById("opt-plans-box").innerHTML="";
  optCandidates=[];
  openDlg("opt-dialog");
}

function getCheckedOptAreas(){
  const cbs=document.querySelectorAll("#opt-area-chips input[type=checkbox]");
  if(!cbs.length)return[];
  return[...cbs].filter(c=>c.checked).map(c=>c.value);
}

function resolveOptPoint(val,gpsPos){
  if(!val)return null;
  if(val==="__GPS__"&&gpsPos)return{type:"custom",name:"Vị trí GPS",lat:gpsPos.lat,lon:gpsPos.lon};
  const h=st.raw.hotels.find(x=>x.name===val);
  if(h)return{type:"hotel",name:h.name,lat:h.lat,lon:h.lon,province:h.province};
  return null;
}

async function runOptimize(){
  const startVal=document.getElementById("opt-start").value;
  const endVal=document.getElementById("opt-end").value;
  const targetDays=parseInt(document.getElementById("opt-target-days").value,10)||0;
  const dirMode=document.getElementById("opt-dir").value;
  const wantOnlyDue=document.getElementById("opt-only-due").checked;
  const btn=document.getElementById("btn-run-opt");

  const provs=getAllProvinces();
  let selectedAreas=getCheckedOptAreas();
  if(provs.length>1&&selectedAreas.length===0){
    alert("Vui lòng chọn ít nhất 1 tỉnh/khu vực để tối ưu!");
    return;
  }
  const isPartialAreas=(provs.length>1&&selectedAreas.length<provs.length);

  let gpsPos=null;
  if(startVal==="__GPS__"||endVal==="__GPS__"){
    const old=btn.textContent;btn.textContent="⏳ Đang lấy GPS...";btn.disabled=true;
    try{gpsPos=await getGPS();st.my_pos=gpsPos;}
    catch(err){alert(err.message);btn.textContent=old;btn.disabled=false;return;}
    btn.textContent=old;btn.disabled=false;
  }

  let fromPt=resolveOptPoint(startVal,gpsPos);
  if(!fromPt&&st.day_end_points[0]?.lat!=null)fromPt=st.day_end_points[0];

  let toPt=null;
  if(endVal==="__SAME__"){
    toPt=fromPt?{...fromPt}:null;
    if(!toPt&&st.raw.shops.length){
      const s0=st.raw.shops[0];
      toPt={type:"custom",name:`Quay về ${s0.name}`,lat:s0.lat,lon:s0.lon};
    }
  }else{
    toPt=resolveOptPoint(endVal,gpsPos);
  }

  let allShops=(st.raw.shops.length?st.raw.shops:st.raw.precomputed).map(s=>({...s}));
  let inAreaShops=isPartialAreas?allShops.filter(s=>selectedAreas.includes(s.province)):allShops;
  const outAreaShops=isPartialAreas?allShops.filter(s=>!selectedAreas.includes(s.province)):[];

  let effectiveOnlyDue=wantOnlyDue;
  if(wantOnlyDue){
    const due=inAreaShops.filter(s=>{const vs=getVisitStatus(s);return vs&&(vs.state==="overdue"||vs.state==="due");});
    if(due.length)inAreaShops=due;
    else{
      alert("Hiện chưa có cửa hàng nào Đến/Quá hạn trong khu vực đang chọn. Sẽ phân tích toàn bộ khu vực đó.");
      effectiveOnlyDue=false;
      document.getElementById("opt-only-due").checked=false;
    }
  }

  const simBefore=computeSchedule(inAreaShops,st.raw.hotels,st.day_end_points,null,toPt);
  const beforeKm=simBefore.totalKm;
  const beforeDays=simBefore.totalDays;

  const simDayEnd={...st.day_end_points};
  if(startVal)simDayEnd[0]=fromPt;

  const overrideMax=targetDays>0?Math.max(1,Math.ceil(inAreaShops.length/targetDays)):null;

  const runWithDir=(fn)=>arr=>{
    if(dirMode==="reverse"){
      return routeFarToNear(arr,fromPt,toPt,fn.isProv,fn.due);
    }
    return fn.run(arr,fromPt,toPt);
  };

  const defs=[
    {title:"PA 1 · Theo cụm Tỉnh",desc:"Đi gọn từng tỉnh, ít chạy qua lại",algo:runWithDir({isProv:true,due:false,run:(a,f,t)=>routeByProvince(a,f,t,false)})},
    {title:"PA 2 · Ngắn nhất (Xuyên tỉnh)",desc:"Tối ưu tổng km ngắn nhất kể cả chặng về",algo:runWithDir({isProv:false,due:false,run:(a,f,t)=>twoOptEndpoints(nn(a,f),f,t)})},
    {title:"PA 3 · Ưu tiên Đến/Quá hạn",desc:"Cụm tỉnh có điểm quá hạn đi trước",algo:runWithDir({isProv:true,due:true,run:(a,f,t)=>routeByProvince(a,f,t,true)})}
  ];

  optCandidates=defs.map(d=>{
    const optPart=d.algo(inAreaShops.map(x=>({...x})));
    const simPart=computeSchedule(optPart,st.raw.hotels,simDayEnd,overrideMax,toPt);
    const fullOrdered=isPartialAreas?[...optPart,...outAreaShops]:optPart;
    return{
      ...d,ordered:fullOrdered,
      totalKm:simPart.totalKm,totalDays:simPart.totalDays,saved:beforeKm-simPart.totalKm,
      beforeKm,beforeDays,
      fromPt:startVal?fromPt:null,toPt,overrideMax,targetDays,onlyDue:effectiveOnlyDue,
      filterProvs:isPartialAreas?selectedAreas:[]
    };
  });

  let minKm=Infinity,bestIdx=0;
  optCandidates.forEach((p,i)=>{if(p.totalKm<minKm){minKm=p.totalKm;bestIdx=i;}});
  const bestP=optCandidates[bestIdx];
  const bestPct=beforeKm>0?Math.round((bestP.saved/beforeKm)*100):0;

  const cw=document.getElementById("opt-compare-wrap");
  cw.style.display="block";
  cw.innerHTML=`
    ${bestP.saved>0.5?`<div class="opt-saving"><span>💚 Gợi ý tốt nhất giúp tiết kiệm ~${bestP.saved.toFixed(1)} km</span><span style="font-size:17px;">-${bestPct}%</span></div>`:""}
    <div class="opt-compare">
      <div class="opt-box"><div class="ob-label">TRƯỚC TỐI ƯU</div><div class="ob-km">${beforeKm.toFixed(0)} km</div><div class="ob-sub">${beforeDays} ngày</div></div>
      <div class="opt-arrow">→</div>
      <div class="opt-box after"><div class="ob-label">PHƯƠNG ÁN TỐT NHẤT</div><div class="ob-km">${bestP.totalKm.toFixed(0)} km</div><div class="ob-sub">${bestP.totalDays} ngày</div></div>
    </div>`;

  document.getElementById("opt-info").innerHTML=`Phân tích <strong>${inAreaShops.length} điểm</strong>${isPartialAreas?` (${selectedAreas.join(", ")})`:""} với giới hạn <strong>${st.max_km} km/ngày</strong>. Chọn 1 phương án bên dưới để áp dụng:`;
  document.getElementById("opt-plans-box").innerHTML=optCandidates.map((p,i)=>{
    const isBest=i===bestIdx;
    const diffTxt=p.saved>=0?`💚 Tiết kiệm ~${p.saved.toFixed(1)} km`:`🔸 +${Math.abs(p.saved).toFixed(1)} km`;
    const dayWarn=(targetDays>0&&p.totalDays>targetDays)?`<div style="color:var(--red);font-size:11.5px;">⚠️ Cần ${p.totalDays} ngày để không vượt ${st.max_km} km/ngày hoặc quá giờ</div>`:"";
    return`<div class="plan-card${isBest?" best":""}">
      <div class="plan-info">
        <strong>${escHtml(p.title)}${isBest?" ⭐ Ngắn nhất":""}</strong>
        <div>${escHtml(p.desc)}</div>
        <div>🛣️ ~${p.totalKm.toFixed(1)} km · ${p.totalDays} ngày · ${diffTxt}</div>
        ${dayWarn}
      </div>
      <button class="btn-sm green compact" onclick="applyOptPlan(${i})">Áp dụng</button>
    </div>`;
  }).join("");
}

function applyOptPlan(idx){
  const p=optCandidates[idx];if(!p)return;
  if(p.fromPt){
    st.day_end_points[0]=p.fromPt;
    localStorage.setItem("lt_day_ends",JSON.stringify(st.day_end_points));
  }
  st.trip_end_point=p.toPt||null;
  if(st.trip_end_point)localStorage.setItem("lt_trip_end",JSON.stringify(st.trip_end_point));
  else localStorage.removeItem("lt_trip_end");

  if(p.overrideMax){
    st.max_shops=p.overrideMax;
    localStorage.setItem("lt_max",String(st.max_shops));
  }

  Object.keys(st.postponed_day).forEach(nm=>{if(getCI(nm))delete st.postponed_day[nm];});
  localStorage.setItem("lt_postponed",JSON.stringify(st.postponed_day));

  st.sel_provinces=p.filterProvs||[];
  localStorage.setItem("lt_sel_provs",JSON.stringify(st.sel_provinces));

  st.only_due=p.onlyDue;
  st.excel_src="optimize";
  st.needs_reopt=false;
  localStorage.setItem("lt_only_due",st.only_due?"1":"0");
  localStorage.setItem("lt_src","optimize");
  localStorage.removeItem("lt_reopt");
  buildSchedule(p.ordered);
  st.sel_day=1;
  closeDlg("opt-dialog");
  renderUI();renderMap();loadDayExtras();
  toast(`✅ Đã áp dụng ${p.title} (~${p.totalKm.toFixed(1)} km)`);
}

function exitOnlyDueMode(){
  st.only_due=false;
  st.custom_order=null;
  localStorage.setItem("lt_only_due","0");
  localStorage.removeItem("lt_order");
  st.sel_day=1;
  refreshAll();
  toast("📋 Đã khôi phục hiển thị toàn bộ cửa hàng");
}

// ── Bộ lọc Tỉnh (Đồng bộ Danh sách + Bản đồ + Tab Ngày + Tuyến ngày) ──
function toggleProvince(prov){
  const idx=st.sel_provinces.indexOf(prov);
  if(idx>=0)st.sel_provinces.splice(idx,1);
  else st.sel_provinces.push(prov);
  localStorage.setItem("lt_sel_provs",JSON.stringify(st.sel_provinces));
  renderUI();renderMap();
}

function clearProvinceFilter(){
  st.sel_provinces=[];
  localStorage.setItem("lt_sel_provs","[]");
  renderUI();renderMap();
}

function renderProvBar(){
  const bar=document.getElementById("prov-filter-bar");
  if(!bar)return;
  const provs=getAllProvinces();
  if(provs.length<=1){bar.style.display="none";return;}
  bar.style.display="flex";
  const base=baseStops();
  let html=`<button class="prov-chip${st.sel_provinces.length===0?" active":""}" onclick="clearProvinceFilter()">🌏 Tất cả <span class="chip-cnt">${base.length}</span></button>`;
  provs.forEach(p=>{
    const cnt=base.filter(s=>s.province===p).length;
    if(!cnt&&!st.sel_provinces.includes(p))return;
    const act=st.sel_provinces.includes(p);
    html+=`<button class="prov-chip${act?" active":""}" onclick="toggleProvince(${JSON.stringify(p).replace(/"/g,"&quot;")})">${escHtml(p)} <span class="chip-cnt">${cnt}</span></button>`;
  });
  bar.innerHTML=html;
}

// ── Thời tiết (08-17h) + OSRM Đường bộ & Khuyến nghị Cao tốc ──
async function loadDayExtras(){
  if(st.sel_day===0||st.search)return;
  const day=st.sel_day;
  const cal=st.day_calendar[day];
  const dayStops=st.schedule.filter(s=>s.day===day);
  if(!dayStops.length)return;

  const{ws,we}=getWorkCfg(day);
  const wsH=Math.floor(ws/60),weH=Math.floor(we/60);
  if(cal){
    const mid=dayStops[Math.floor(dayStops.length/2)];
    fetchDayWeather(mid.lat,mid.lon,cal.iso,wsH,weH).then(wx=>{
      if(wx&&st.sel_day===day){
        st.weather_by_day[`${day}_${cal.iso}`]=wx;
        renderDayMetaBar();
      }
    });
  }

  const pts=[];
  const startPt=day===1?st.day_end_points[0]:st.hotels_by_day[day-1];
  const hasStart=Boolean(startPt?.lat!=null&&startPt?.lon!=null);
  if(hasStart)pts.push({lat:startPt.lat,lon:startPt.lon});
  dayStops.forEach(s=>pts.push({lat:s.lat,lon:s.lon}));
  const endH=st.hotels_by_day[day];
  const hasEnd=Boolean(endH?.lat!=null&&endH?.lon!=null&&endH.type!=="last_shop");
  if(hasEnd)pts.push({lat:endH.lat,lon:endH.lon});

  if(pts.length>=2&&pts.length<=25){
    const rt=await fetchOSRMRoute(pts,st.mode==="oto");
    if(rt&&st.sel_day===day){
      const legByStop={};
      dayStops.forEach((s,idx)=>{
        const legIdx=hasStart?idx:idx-1;
        if(legIdx>=0&&rt.legs[legIdx])legByStop[s.stt]=rt.legs[legIdx];
      });
      const hotelLeg=hasEnd?rt.legs[rt.legs.length-1]:null;
      st.osrm_by_day[day]={...rt,legByStop,hotelLeg};
      renderUI();
      renderMap();
    }
  }
}

function toggleAvoidHighwaysQuick(){
  st.avoid_highways=!st.avoid_highways;
  localStorage.setItem("lt_avoid_hw",st.avoid_highways?"1":"0");
  renderUI();renderMap();
  toast(st.avoid_highways?"🛣️ Google Maps sẽ tránh cao tốc":"🛣️ Google Maps ưu tiên đường nhanh/cao tốc");
}

function renderDayMetaBar(){
  const bar=document.getElementById("day-meta-bar");
  const vis=visibleStops();
  const doneCnt=vis.filter(s=>!!getCI(s.name)).length;
  const fullDayNoFilter=(!st.search&&st.status_filter==="all"&&st.sel_provinces.length===0&&st.sel_day!==0);
  const osrm=fullDayNoFilter?st.osrm_by_day[st.sel_day]:null;
  const hEnd=fullDayNoFilter?st.hotels_by_day[st.sel_day]:null;
  const fallbackKm=vis.reduce((s,x)=>s+(x.distKm||0),0)+(hEnd&&hEnd.type!=="last_shop"?(hEnd.dist||0):0);
  const km=osrm?osrm.totalKm:fallbackKm;
  const dupChip=st.duplicates.length?`<span class="meta-chip warn" onclick="showDuplicates()">⚠️ ${st.duplicates.length} trùng</span>`:"";

  if(st.sel_day===0||st.search){
    bar.innerHTML=`
      <div class="day-meta-info">
        <span class="meta-chip prog">✅ ${doneCnt}/${vis.length} điểm</span>
        <span class="meta-chip">🛣️ ~${km.toFixed(1)} km</span>
        ${dupChip}
      </div>
      <button class="btn-mini-rep" onclick="openStatsDialog()">📊 Thống kê</button>`;
    return;
  }

  const cal=st.day_calendar[st.sel_day];
  const wx=cal?st.weather_by_day[`${st.sel_day}_${cal.iso}`]:null;
  const maxKm=st.max_km||(MODES[st.mode]||MODES.xemay).maxKm;
  const isKmOver=(km>maxKm+0.5);
  let kmTxt=`~${km.toFixed(1)} km`;
  if(osrm){
    const hh=Math.floor(osrm.totalMin/60),mm=osrm.totalMin%60;
    kmTxt=`🛣️ ${osrm.totalKm.toFixed(1)} km (${hh?`${hh}h`:""}${mm}p)`;
  }

  let hwChip="";
  if(st.mode==="oto"){
    if(osrm?.alt){
      const diffMin=osrm.alt.totalMin-osrm.totalMin;
      hwChip=`<span class="meta-chip road" style="cursor:pointer;" title="Chạm để bật/tắt Tránh cao tốc khi mở Google Maps" onclick="toggleAvoidHighwaysQuick()">🚗 ${st.avoid_highways?"Đường thường":"Nhanh/Cao tốc"} · Alt: ${osrm.alt.totalKm.toFixed(0)}km (+${diffMin}p)</span>`;
    }else{
      hwChip=`<span class="meta-chip road" style="cursor:pointer;" onclick="toggleAvoidHighwaysQuick()">🚗 ${st.avoid_highways?"Đang tránh cao tốc":"Cho phép cao tốc"}</span>`;
    }
  }

  const wxLabel=wx?`${wx.icon} ${wx.tMin}–${wx.tMax}°C · ${wx.rain}% mưa${wx.mm>=0.4?` (${wx.mm}mm)`:""}`:"";

  bar.innerHTML=`
    <div class="day-meta-info">
      ${cal?`<span class="meta-chip">📅 ${escHtml(cal.weekday)} ${escHtml(cal.solar)} (${escHtml(cal.lunar)})</span>`:""}
      ${cal?.holiday?`<span class="meta-chip hol">🎉 ${escHtml(cal.holiday)}</span>`:(cal?.isSunday?`<span class="meta-chip hol">☀️ CN</span>`:"")}
      ${wxLabel?`<span class="meta-chip wx" title="Dự báo trong khung giờ làm việc">${wxLabel}</span>`:""}
      <span class="meta-chip${isKmOver?" over":""}" title="Giới hạn hiện tại: ${maxKm} km/ngày">${isKmOver?"⚠️ ":""}${kmTxt}</span>
      <span class="meta-chip prog">✅ ${doneCnt}/${vis.length}</span>
      ${hwChip}
      ${dupChip}
    </div>
    <button class="btn-mini-rep" onclick="copyDayReport(${st.sel_day})">📋 Zalo</button>`;
}

function copyCurrentReport(){
  const d=st.sel_day>0?st.sel_day:1;
  copyDayReport(d);
}

async function copyDayReport(day){
  const stops=st.schedule.filter(s=>s.day===day);if(!stops.length){toast("Chưa có dữ liệu để copy!");return;}
  const cal=st.day_calendar[day];
  const wx=cal?st.weather_by_day[`${day}_${cal.iso}`]:null;
  const osrm=st.osrm_by_day[day];
  const doneCnt=stops.filter(s=>!!getCI(s.name)).length;
  const h=st.hotels_by_day[day];
  const km=osrm?osrm.totalKm:(stops.reduce((a,s)=>a+(s.distKm||0),0)+(h&&h.type!=="last_shop"?(h.dist||0):0));
  const lines=[
    `📌 BÁO CÁO LỘ TRÌNH NGÀY ${day}${cal?` (${cal.weekday} ${cal.solar} · ${cal.lunar})`:""}`,
    wx?`🌤️ Thời tiết giờ làm: ${wx.text} ${wx.tMin}–${wx.tMax}°C (mưa ${wx.rain}%)`:null,
    `✅ Tiến độ: ${doneCnt}/${stops.length} cửa hàng · ~${km.toFixed(1)} km${osrm?" (đường bộ cả chặng về)":""}`,
    ""
  ].filter(x=>x!==null);
  stops.forEach((s,i)=>{
    const ci=getCI(s.name);
    lines.push(`${i+1}. ${s.name} (${s.province}) — ${ci?`✅ Đã ghé${ci.time?" "+ci.time:""}`:"⬜ Chưa ghé"}${ci?.note?` | 📝 ${ci.note}`:""}`);
  });
  if(h){
    const ret=getHotelReturnInfo(day,stops);
    lines.push("",`🏨 Nghỉ/Kết thúc: ${h.name}${ret?` (Về lúc ${ret.arriveTime}, +${ret.km.toFixed(1)} km)`:""}`);
  }
  const text=lines.join("\n");
  try{
    await navigator.clipboard.writeText(text);
    toast("📋 Đã copy báo cáo ngày! Dán vào Zalo để gửi.");
  }catch{
    prompt("Copy nội dung báo cáo bên dưới:",text);
  }
}

// ── Thống kê & Chi phí xăng xe ─────────────────────────────
function updateFuelEstimate(val){
  const rate=Math.max(0,parseInt(val,10)||0);
  st.fuel_rate=rate;
  localStorage.setItem("lt_fuel_rate",String(rate));
  const totalKm=st.schedule.reduce((a,s)=>a+(s.distKm||0),0)
    +Object.values(st.hotels_by_day).reduce((s,h)=>s+(h&&h.type!=="last_shop"?(h.dist||0):0),0);
  const el=document.getElementById("stats-fuel-total");
  if(el)el.textContent=`${Math.round(totalKm*rate).toLocaleString("vi-VN")} đ`;
}

function openStatsDialog(){
  const shops=st.raw.shops.length?st.raw.shops:st.schedule;
  const totalKm=st.schedule.reduce((a,s)=>a+(s.distKm||0),0)
    +Object.values(st.hotels_by_day).reduce((s,h)=>s+(h&&h.type!=="last_shop"?(h.dist||0):0),0);
  const totalDays=st.schedule.reduce((m,s)=>Math.max(m,s.day),0);
  const doneCnt=st.schedule.filter(s=>!!getCI(s.name)).length;
  let overdueCnt=0,dueCnt=0;
  const byProv={};
  shops.forEach(s=>{
    const vs=getVisitStatus(s);
    if(vs?.state==="overdue")overdueCnt++;
    else if(vs?.state==="due")dueCnt++;
    if(!byProv[s.province])byProv[s.province]={total:0,done:0};
    byProv[s.province].total++;
    if(getCI(s.name))byProv[s.province].done++;
  });

  const notes=[];
  st.schedule.forEach(s=>{
    const ci=getCI(s.name);
    if(ci?.note)notes.push({name:s.name,time:ci.time,note:ci.note});
  });

  document.getElementById("stats-body").innerHTML=`
    <div class="stat-grid">
      <div class="stat-card"><small>Tổng cửa hàng</small><strong>${shops.length} điểm</strong></div>
      <div class="stat-card"><small>Tiến độ chuyến này</small><strong style="color:var(--acc);">${doneCnt}/${st.schedule.length}</strong></div>
      <div class="stat-card"><small>Tổng quãng đường (cả về)</small><strong>${totalDays} ngày · ~${totalKm.toFixed(0)} km</strong></div>
      <div class="stat-card"><small>Cần đi (Quá/Đến hạn)</small><strong style="color:var(--red);">${overdueCnt+dueCnt} điểm</strong></div>
    </div>
    <div class="stat-card" style="margin-bottom:12px;">
      <small>⛽ Ước tính chi phí xăng xe (đ/km)</small>
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:4px;">
        <input id="stats-fuel-rate" type="number" inputmode="numeric" value="${st.fuel_rate}" oninput="updateFuelEstimate(this.value)" style="width:120px;padding:6px 8px;border:1px solid var(--bdr);border-radius:8px;font-size:15px;font-weight:700;"/>
        <strong id="stats-fuel-total" style="color:var(--acc);">${Math.round(totalKm*st.fuel_rate).toLocaleString("vi-VN")} đ</strong>
      </div>
    </div>
    <div style="font-size:12.5px;font-weight:700;color:var(--muted);margin-bottom:6px;">📍 Phân bổ theo Tỉnh</div>
    ${Object.entries(byProv).map(([p,v])=>`<div class="hotel-row" style="padding:8px 10px;margin-bottom:6px;"><strong>${escHtml(p)}</strong><span>${v.done}/${v.total} đã ghé</span></div>`).join("")}
    <div style="font-size:12.5px;font-weight:700;color:var(--muted);margin:12px 0 6px;">📝 Ghi chú đơn hàng chuyến này (${notes.length})</div>
    ${notes.length?notes.map(n=>`<div class="hist-item"><strong>${escHtml(n.name)}</strong>${n.time?` (${escHtml(n.time)})`:""}<br/>${escHtml(n.note)}</div>`).join(""):`<div style="font-size:12.5px;color:var(--muted);">Chưa có ghi chú nào trong chuyến này.</div>`}
  `;
  openDlg("stats-dialog");
}

async function copyAllNotesReport(){
  const lines=["📝 TỔNG HỢP GHI CHÚ ĐƠN HÀNG:"];
  let cnt=0;
  st.schedule.forEach(s=>{
    const ci=getCI(s.name);
    if(ci?.note){cnt++;lines.push(`• ${s.name}: ${ci.note}`);}
  });
  if(!cnt){toast("Chưa có ghi chú nào để copy!");return;}
  const txt=lines.join("\n");
  try{await navigator.clipboard.writeText(txt);toast("📋 Đã copy toàn bộ ghi chú!");}
  catch{prompt("Copy nội dung:",txt);}
}

// ── Tìm kiếm, Lọc & Điều hướng (Không tab trắng trên iOS) ───
function onSearchInput(){
  st.search=document.getElementById("search-input").value;
  document.getElementById("search-clear").style.display=st.search?"block":"none";
  renderUI();renderMap();
}
function clearSearch(){
  document.getElementById("search-input").value="";
  st.search="";
  document.getElementById("search-clear").style.display="none";
  renderUI();renderMap();loadDayExtras();
}
function onFilterChange(){
  st.status_filter=document.getElementById("filter-status").value;
  renderUI();renderMap();
}

function navDestParam(pt){
  if(st.nav_label_mode==="name"){
    const meta=getShopMeta(pt.name)||pt;
    const label=[pt.name,meta.address,pt.province].filter(Boolean).join(", ");
    if(label)return encodeURIComponent(label);
  }
  return `${pt.lat},${pt.lon}`;
}

function navUrl(s){
  const avoid=(st.mode==="oto"&&st.avoid_highways)?"&avoid=highways,tolls":"";
  return `https://www.google.com/maps/dir/?api=1&destination=${navDestParam(s)}&travelmode=driving${avoid}`;
}

function baseStops(){
  const q=normVN(st.search);
  if(q)return st.schedule.filter(s=>normVN(s.name).includes(q)||normVN(s.province).includes(q));
  return st.sel_day===0?st.schedule:st.schedule.filter(s=>s.day===st.sel_day);
}

function visibleStops(){
  let list=baseStops();
  if(st.sel_provinces.length>0)list=list.filter(s=>st.sel_provinces.includes(s.province));
  if(st.status_filter==="todo")list=list.filter(s=>!getCI(s.name));
  else if(st.status_filter==="done")list=list.filter(s=>!!getCI(s.name));
  else if(st.status_filter==="due")list=list.filter(s=>{const vs=getVisitStatus(getShopMeta(s.name)||s);return vs&&(vs.state==="overdue"||vs.state==="due");});
  return list;
}

function getNextNavTarget(){
  const stops=visibleStops();
  return stops.find(s=>!getCI(s.name))||stops[0]||null;
}

function getDayNavList(){
  const stops=visibleStops();if(!stops.length)return[];
  const todo=stops.filter(s=>!getCI(s.name));
  const list=(todo.length>0&&todo.length<stops.length)?[...todo]:[...stops];
  if(st.inc_hotel_route&&!st.search&&st.sel_day!==0){
    const h=st.hotels_by_day[st.sel_day];
    if(h?.lat!=null&&h?.lon!=null&&h.type!=="last_shop"&&hotelMatchesFilter(h,stops))list.push(h);
  }
  return list;
}

function getDayRouteUrl(list){
  if(!list.length)return"#";
  if(list.length===1)return navUrl(list[0]);
  const sl=list.slice(0,10);
  const dest=sl[sl.length-1];
  const wp=sl.slice(0,-1).map(s=>`${s.lat},${s.lon}`).join("|");
  const avoid=(st.mode==="oto"&&st.avoid_highways)?"&avoid=highways,tolls":"";
  return `https://www.google.com/maps/dir/?api=1&destination=${navDestParam(dest)}${wp?`&waypoints=${encodeURIComponent(wp)}`:""}&travelmode=driving${avoid}`;
}

function syncNavActionLinks(){
  const nextBtn=document.getElementById("btn-nav-next");
  const dayBtn=document.getElementById("btn-nav-day");
  const nx=getNextNavTarget();
  if(nx){
    nextBtn.href=navUrl(nx);
    nextBtn.classList.remove("disabled");
  }else{
    nextBtn.href="#";
    nextBtn.classList.add("disabled");
  }
  const dayList=getDayNavList();
  if(dayList.length){
    dayBtn.href=getDayRouteUrl(dayList);
    dayBtn.classList.remove("disabled");
  }else{
    dayBtn.href="#";
    dayBtn.classList.add("disabled");
  }
}

function onClickNextNav(e){
  const nx=getNextNavTarget();
  if(!nx){e.preventDefault();toast("Không có điểm nào để dẫn đường");return false;}
  return true;
}

function onClickDayNav(e){
  const list=getDayNavList();
  if(!list.length){e.preventDefault();toast("Không có điểm nào để dẫn đường");return false;}
  if(list.length>10&&!confirm(`Đang có ${list.length} điểm. Google Maps hỗ trợ tối đa 10 điểm dừng trên 1 tuyến từ GPS hiện tại.\n\nBạn có muốn mở 10 điểm đầu tiên không?`)){
    e.preventDefault();
    return false;
  }
  return true;
}

// ── Bottom Nav ──────────────────────────────────────────────
function renderBottomNav(){
  const bn=document.getElementById("bottom-nav");
  if(!bn)return;
  const tab=st.bnav_tab||"list";
  bn.innerHTML=`
    <button class="bnav-item${tab==="map"?" active":""}" onclick="bnavSwitch('map')">
      <span class="bnav-icon">🗺️</span>Bản đồ
    </button>
    <button class="bnav-item${tab==="list"?" active":""}" onclick="bnavSwitch('list')">
      <span class="bnav-icon">📋</span>Lịch trình
    </button>
    <button class="bnav-item" onclick="bnavSwitch('add')">
      <span class="bnav-icon">➕</span>Thêm
    </button>
    <button class="bnav-item opt-btn" onclick="bnavSwitch('opt')">
      <span class="bnav-icon">⚡</span>Tối ưu
      <span class="bnav-dot${st.needs_reopt?" show":""}"></span>
    </button>
    <button class="bnav-item" onclick="bnavSwitch('cfg')">
      <span class="bnav-icon">⚙️</span>Cài đặt
    </button>`;
}

function bnavSwitch(tab){
  if(tab==="add"){openPointDialog("shop");return;}
  if(tab==="opt"){openOptimize();return;}
  if(tab==="cfg"){openSettings();return;}
  st.bnav_tab=tab;
  if(tab==="map"){
    document.body.classList.remove("map-collapsed");
    document.body.classList.add("map-expanded");
  }else{
    document.body.classList.remove("map-expanded","map-collapsed");
  }
  setTimeout(()=>lmap.invalidateSize(),220);
  renderBottomNav();
}

// ── Render UI ───────────────────────────────────────────────
function toggleModeQuick(){
  const next=st.mode==="xemay"?"oto":"xemay";
  st.mode=next;
  st.max_shops=MODES[next].max;
  st.max_km=MODES[next].maxKm;
  st.excel_src="optimize";
  localStorage.setItem("lt_mode",next);
  localStorage.setItem("lt_max",String(st.max_shops));
  localStorage.setItem("lt_max_km",String(st.max_km));
  localStorage.setItem("lt_src","optimize");
  st.sel_day=1;
  refreshAll();
  toast(`Đã chuyển sang ${MODES[next].label} (max ${st.max_shops} điểm · ${st.max_km} km/ngày)`);
}

function selectDay(d){
  st.sel_day=d;
  if(d>0&&st.sel_provinces.length>0){
    const hasMatch=st.schedule.some(s=>s.day===d&&st.sel_provinces.includes(s.province));
    if(!hasMatch){
      st.sel_provinces=[];
      localStorage.setItem("lt_sel_provs","[]");
      toast(`🌏 Đã hiện tất cả tỉnh cho Ngày ${d}`);
    }
  }
  clearSearch();renderUI();renderMap();loadDayExtras();
}

function renderUI(){
  const prof=MODES[st.mode]||MODES.xemay;
  const totalDays=st.schedule.reduce((m,s)=>Math.max(m,s.day),0);
  const vis=visibleStops();
  const perDayMode=(!st.search&&st.sel_day!==0);
  const fullDayNoFilter=(perDayMode&&st.status_filter==="all"&&st.sel_provinces.length===0);
  const osrmCur=fullDayNoFilter?st.osrm_by_day[st.sel_day]:null;
  const osrmTimes=fullDayNoFilter?getDisplayTimesForDay(st.sel_day,vis):{};

  const activeWs=(st.sel_day>0&&st.day_start_times[st.sel_day])?st.day_start_times[st.sel_day]:st.cfg.ws;
  document.getElementById("sub-title").textContent=`${st.mode==="xemay"?"🛵":"🚗"} ${prof.label} · ${activeWs}–${st.cfg.we} · ≤${st.max_km}km/ngày ⇄`;
  document.getElementById("opt-dot").classList.toggle("show",st.needs_reopt);
  document.getElementById("btn-edit-mode").classList.toggle("active",st.edit_mode);

  const matchProv=s=>st.sel_provinces.length===0||st.sel_provinces.includes(s.province);
  const totalMatching=st.schedule.filter(matchProv).length;
  const te=document.getElementById("day-tabs");
  let th=`<button class="day-tab ${st.sel_day===0&&!st.search?"active":""}" onclick="selectDay(0)">Tất cả (${totalMatching})</button>`;
  for(let d=1;d<=totalDays;d++){
    const c=st.schedule.filter(s=>s.day===d&&matchProv(s)).length;
    const cal=st.day_calendar[d];
    const warnOff=cal&&cal.isOff;
    th+=`<button class="day-tab ${st.sel_day===d&&!st.search?"active":""}${warnOff?" sunday":""}" onclick="selectDay(${d})">Ngày ${d}${cal?` · ${cal.solar}`:""} (${c})</button>`;
  }
  te.innerHTML=th;
  renderDayMetaBar();
  renderProvBar();
  renderBottomNav();
  syncNavActionLinks();

  const le=document.getElementById("schedule-list");
  let html="";

  if(st.only_due){
    html+=`<div class="due-banner">
      <span>⏰ Đang chỉ lập tuyến cho điểm Đến / Quá hạn</span>
      <button class="btn-mini-rep" onclick="exitOnlyDueMode()">Hiện tất cả</button>
    </div>`;
  }

  if(fullDayNoFilter&&vis.length){
    const curStartVal=st.day_start_times[st.sel_day]||st.cfg.ws;
    if(st.sel_day===1){
      const s0=st.day_end_points[0];
      html+=`<div class="start-strip">
        <span>🚩 Xuất phát: <strong>${s0?.name?escHtml(s0.name):"Điểm #1"}</strong> <button class="btn-mini-rep" style="margin-left:4px;" onclick="openDayEndDialog(0)">Đổi</button></span>
        <span>⏰ <input type="time" class="time-inline" value="${escHtml(curStartVal)}" onchange="onDayStartTimeChange(1,this.value)"/></span>
      </div>`;
    }else{
      const prevH=st.hotels_by_day[st.sel_day-1];
      html+=`<div class="start-strip">
        <span>🚩 Xuất phát N${st.sel_day}: <strong>${escHtml(prevH?.name||"Điểm cuối ngày trước")}</strong></span>
        <span>⏰ <input type="time" class="time-inline" value="${escHtml(curStartVal)}" onchange="onDayStartTimeChange(${st.sel_day},this.value)"/></span>
      </div>`;
    }
  }

  vis.forEach(s=>{
    const ci=getCI(s.name);
    const meta=getShopMeta(s.name)||s;
    const vs=getVisitStatus(meta);
    const lbl=perDayMode?(s.dayStt||s.stt):s.stt;
    const osrmLeg=osrmCur?.legByStop?.[s.stt];
    const dt=osrmTimes[s.stt]||{arriveTime:s.arriveTime,departTime:s.departTime,overtime:s.overtime};
    const distTxt=osrmLeg?`+${osrmLeg.km.toFixed(1)} km (~${osrmLeg.min}p)`:`+${(s.distKm||0).toFixed(1)} km`;
    let myDistTag="";
    if(st.my_pos){
      const dKm=hav(st.my_pos.lat,st.my_pos.lon,s.lat,s.lon);
      myDistTag=`<span class="vtag dist">📍 ${dKm<1?`${Math.round(dKm*1000)}m`:`${dKm.toFixed(1)} km`}</span>`;
    }
    html+=`<div class="shop-card${ci?" done":""}" data-stt="${s.stt}">
      <div class="shop-top" onclick="focusStop(${s.stt})">
        ${st.edit_mode?`<span class="drag-handle" title="Kéo giữ để đổi thứ tự" onclick="event.stopPropagation()">⋮⋮</span>`:""}
        <span class="badge">${lbl}</span>
        <div class="shop-info">
          <strong>${escHtml(s.name)}</strong>
          ${meta.address?`<div class="shop-addr">🏠 ${escHtml(meta.address)}</div>`:""}
          <div class="shop-meta">${escHtml(s.province)}${!perDayMode?` · Ngày ${s.day}`:""} · ${distTxt}${meta.svcMin?` · ${meta.svcMin}p`:""}</div>
          ${(vs||myDistTag)?`<div class="shop-tags">${vs?`<span class="vtag ${vs.cls}">🔄 ${escHtml(vs.label)}</span>`:""}${myDistTag}</div>`:""}
          ${ci?.note?`<div class="shop-note">📝 ${escHtml(ci.note)}</div>`:""}
        </div>
        <span class="shop-time${dt.overtime?" overtime":""}">${dt.overtime?"⚠️ ":""}${escHtml(dt.arriveTime)}–${escHtml(dt.departTime)}</span>
      </div>
      <div class="shop-acts">
        <a class="btn-sm green" href="${navUrl(s)}" target="_blank" rel="noopener noreferrer">🧭 Đường</a>
        <button class="btn-sm${ci?" checked":""}" onclick="toggleCheckin(${s.stt})">${ci?`✅ ${ci.time||"Đã ghé"}`:"⬜ Check-in"}</button>
        <button class="btn-sm compact" title="Ghi chú, Dời ngày & Lịch sử" onclick="openNoteDialog(${s.stt})">📝</button>
      </div>
      ${st.edit_mode?`<div class="shop-edit-acts">
        <button class="btn-sm" onclick="editShopByStt(${s.stt})">✏️ Sửa / Đổi STT</button>
        <button class="btn-sm compact" onclick="moveStop(${s.stt},-1)">▲ Lên</button>
        <button class="btn-sm compact" onclick="moveStop(${s.stt},1)">▼ Xuống</button>
      </div>`:""}
    </div>`;
  });

  const hEnd=(perDayMode&&st.status_filter==="all")?st.hotels_by_day[st.sel_day]:null;
  if(perDayMode&&st.status_filter==="all"&&vis.length&&hotelMatchesFilter(hEnd,vis)){
    const h=hEnd;
    const hasNext=st.sel_day<totalDays;
    const ret=getHotelReturnInfo(st.sel_day,vis);
    const subTxt=h?(h.type==="last_shop"?"Tại cửa hàng cuối ngày":`+${ret?ret.km.toFixed(1):(h.dist||0).toFixed(1)} km${ret?` (~${ret.min}p)`:""} về chỗ nghỉ`):"Tại điểm cuối cùng của ngày";
    const hu=h?.lat!=null?`https://www.google.com/maps/dir/?api=1&destination=${h.lat},${h.lon}&travelmode=driving${st.mode==="oto"&&st.avoid_highways?"&avoid=highways,tolls":""}`:"#";
    const hIdx=h?st.raw.hotels.findIndex(x=>x.name===h.name):-1;
    html+=`<div class="shop-card hotel-card">
      <div class="shop-top">
        <span class="badge hotel">H</span>
        <div class="shop-info">
          <strong>${h?.type==="last_shop"?"📌":"🏨"} ${escHtml(h?.name||vis[vis.length-1].name)}</strong>
          <div class="shop-meta">${hasNext?`Chặng về & Bắt đầu N${st.sel_day+1}`:`Chặng về cuối Ngày ${st.sel_day}`} · ${subTxt}</div>
        </div>
        <span class="shop-time${ret?.overtime?" overtime":" hotel"}">${ret?`${ret.overtime?"⚠️ ":""}Về ${ret.arriveTime}`:"Nghỉ đêm"}</span>
      </div>
      <div class="shop-acts">
        ${h?.lat!=null&&h.type!=="last_shop"?`<a class="btn-sm green" href="${hu}" target="_blank" rel="noopener noreferrer">🧭 Đường</a>`:""}
        <button class="btn-sm" onclick="openDayEndDialog(${st.sel_day})">📍 Đổi điểm cuối${hasNext?` / BĐ N${st.sel_day+1}`:""}</button>
        ${st.edit_mode&&hIdx>=0?`<button class="btn-sm compact" onclick="editHotel(${hIdx})">✏️</button><button class="btn-sm compact red" onclick="deleteHotel(${hIdx})">🗑️</button>`:""}
      </div>
    </div>`;
  }

  le.innerHTML=html||`<div style="text-align:center;padding:40px 16px;color:var(--muted);">
    <div style="font-size:36px;margin-bottom:12px;">🗺️</div>
    <div style="font-weight:600;margin-bottom:6px;">${st.search||st.status_filter!=="all"||st.sel_provinces.length?"Không có điểm phù hợp bộ lọc":"Chưa có dữ liệu"}</div>
    <div style="font-size:13px;">${st.search||st.status_filter!=="all"||st.sel_provinces.length?"Thử đổi bộ lọc hoặc xoá từ khóa tìm kiếm":"Mở ☰ Menu → Nhập Excel hoặc bấm ➕ Điểm để thêm mới"}</div>
  </div>`;
}

function editShopByStt(stt){
  const item=st.schedule.find(s=>s.stt===stt);if(!item)return;
  const rawShop=st.raw.shops.find(s=>s.name===item.name)||item;
  openPointDialog("shop",rawShop);
}

// ── Cài đặt & Sao lưu / Khôi phục JSON ──────────────────────
function openSettings(){
  document.getElementById("cfg-mode").value=st.mode;
  document.getElementById("cfg-max").value=st.max_shops;
  document.getElementById("cfg-max-km").value=st.max_km;
  document.getElementById("cfg-svc").value=st.cfg.svc;
  document.getElementById("cfg-ws").value=st.cfg.ws;
  document.getElementById("cfg-we").value=st.cfg.we;
  document.getElementById("cfg-ls").value=st.cfg.ls;
  document.getElementById("cfg-le").value=st.cfg.le;
  document.getElementById("cfg-start-date").value=st.start_date;
  document.getElementById("cfg-nav-label").value=st.nav_label_mode;
  document.getElementById("cfg-skip-off").checked=st.skip_off_days;
  document.getElementById("cfg-avoid-hw").checked=st.avoid_highways;
  document.getElementById("cfg-inc-hotel-route").checked=st.inc_hotel_route;
  openDlg("settings-dialog");
}
function onCfgModeChange(){
  const m=document.getElementById("cfg-mode").value;
  document.getElementById("cfg-max").value=MODES[m]?.max||4;
  document.getElementById("cfg-max-km").value=MODES[m]?.maxKm||90;
}
function saveSettings(){
  st.mode=document.getElementById("cfg-mode").value;
  const mv=parseInt(document.getElementById("cfg-max").value,10);
  const mk=parseInt(document.getElementById("cfg-max-km").value,10);
  st.max_shops=mv>0?mv:(MODES[st.mode]?.max||4);
  st.max_km=mk>0?mk:(MODES[st.mode]?.maxKm||90);
  st.cfg={
    ws:document.getElementById("cfg-ws").value||"08:00",
    ls:document.getElementById("cfg-ls").value||"11:00",
    le:document.getElementById("cfg-le").value||"13:00",
    we:document.getElementById("cfg-we").value||"17:00",
    svc:Math.max(5,parseInt(document.getElementById("cfg-svc").value,10)||30)
  };
  st.start_date=document.getElementById("cfg-start-date").value||toLocalIso();
  st.nav_label_mode=document.getElementById("cfg-nav-label").value||"coords";
  st.skip_off_days=document.getElementById("cfg-skip-off").checked;
  st.avoid_highways=document.getElementById("cfg-avoid-hw").checked;
  st.inc_hotel_route=document.getElementById("cfg-inc-hotel-route").checked;
  st.excel_src="optimize";
  localStorage.setItem("lt_mode",st.mode);localStorage.setItem("lt_max",String(st.max_shops));localStorage.setItem("lt_max_km",String(st.max_km));
  localStorage.setItem("lt_cfg",JSON.stringify(st.cfg));
  localStorage.setItem("lt_start_date",st.start_date);localStorage.setItem("lt_skip_off",st.skip_off_days?"1":"0");
  localStorage.setItem("lt_nav_label",st.nav_label_mode);
  localStorage.setItem("lt_avoid_hw",st.avoid_highways?"1":"0");
  localStorage.setItem("lt_inc_hotel",st.inc_hotel_route?"1":"0");
  localStorage.setItem("lt_src","optimize");
  closeDlg("settings-dialog");
  st.sel_day=1;refreshAll();
  toast("⚙️ Đã lưu cài đặt");
}
function resetData(){
  if(!confirm("Reset toàn bộ dữ liệu, lịch sử ghé, điểm xuất phát và thứ tự tối ưu?"))return;
  ["lt_raw","lt_order","lt_day_ends","lt_day_starts","lt_postponed","lt_trip_end","lt_sel_provs","lt_reopt","lt_start_date","lt_skip_off","lt_cfg","lt_history","lt_only_due","lt_ci","lt_avoid_hw","lt_nav_label","lt_inc_hotel","lt_fuel_rate","lt_max_km"].forEach(k=>localStorage.removeItem(k));
  location.reload();
}
function clearCheckins(){
  if(!confirm("Xoá trạng thái Check-in chuyến này để bắt đầu chuyến mới?\n(Lịch sử các lần ghé trước vẫn được giữ lại)"))return;
  st.checkins={};st.postponed_day={};
  localStorage.removeItem("lt_ci");localStorage.removeItem("lt_postponed");
  refreshAll();
  toast("🧹 Đã bắt đầu chuyến mới (giữ nguyên lịch sử ghé)");
}

function backupJSON(){
  const data={
    version:4,
    exportedAt:new Date().toISOString(),
    lt_raw:st.raw,lt_order:st.custom_order,lt_day_ends:st.day_end_points,
    lt_day_starts:st.day_start_times,lt_postponed:st.postponed_day,lt_trip_end:st.trip_end_point,
    lt_sel_provs:st.sel_provinces,
    lt_ci:st.checkins,lt_history:st.visit_history,lt_cfg:st.cfg,
    lt_mode:st.mode,lt_max:st.max_shops,lt_max_km:st.max_km,lt_src:st.excel_src,
    lt_start_date:st.start_date,lt_skip_off:st.skip_off_days,lt_only_due:st.only_due,
    lt_avoid_hw:st.avoid_highways,lt_nav_label:st.nav_label_mode,lt_inc_hotel:st.inc_hotel_route,lt_fuel_rate:st.fuel_rate
  };
  const blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json"});
  const a=document.createElement("a");
  a.href=URL.createObjectURL(blob);
  a.download=`Backup_LoTrinh_${toLocalIso()}.json`;
  a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),1000);
  toast("💾 Đã tải file sao lưu JSON!");
}

document.getElementById("restore-json-input").addEventListener("change",async e=>{
  const f=e.target.files?.[0];e.target.value="";
  if(!f)return;
  try{
    const txt=await f.text();
    const d=JSON.parse(txt);
    if(!d||!d.lt_raw||!Array.isArray(d.lt_raw.shops)){alert("File sao lưu không hợp lệ!");return;}
    if(!confirm("Khôi phục dữ liệu từ file backup? Dữ liệu hiện tại trên trình duyệt sẽ được thay thế."))return;
    localStorage.setItem("lt_raw",JSON.stringify(d.lt_raw));
    if(d.lt_order)localStorage.setItem("lt_order",JSON.stringify(d.lt_order));else localStorage.removeItem("lt_order");
    localStorage.setItem("lt_day_ends",JSON.stringify(d.lt_day_ends||{}));
    localStorage.setItem("lt_day_starts",JSON.stringify(d.lt_day_starts||{}));
    localStorage.setItem("lt_postponed",JSON.stringify(d.lt_postponed||{}));
    if(d.lt_trip_end)localStorage.setItem("lt_trip_end",JSON.stringify(d.lt_trip_end));else localStorage.removeItem("lt_trip_end");
    localStorage.setItem("lt_sel_provs",JSON.stringify(d.lt_sel_provs||[]));
    localStorage.setItem("lt_ci",JSON.stringify(d.lt_ci||{}));
    localStorage.setItem("lt_history",JSON.stringify(d.lt_history||{}));
    if(d.lt_cfg)localStorage.setItem("lt_cfg",JSON.stringify(d.lt_cfg));
    if(d.lt_mode)localStorage.setItem("lt_mode",d.lt_mode);
    if(d.lt_max)localStorage.setItem("lt_max",String(d.lt_max));
    if(d.lt_max_km)localStorage.setItem("lt_max_km",String(d.lt_max_km));
    if(d.lt_src)localStorage.setItem("lt_src",d.lt_src);
    if(d.lt_start_date)localStorage.setItem("lt_start_date",d.lt_start_date);
    localStorage.setItem("lt_skip_off",d.lt_skip_off?"1":"0");
    localStorage.setItem("lt_only_due",d.lt_only_due?"1":"0");
    localStorage.setItem("lt_avoid_hw",d.lt_avoid_hw?"1":"0");
    if(d.lt_nav_label)localStorage.setItem("lt_nav_label",d.lt_nav_label);
    localStorage.setItem("lt_inc_hotel",d.lt_inc_hotel===false?"0":"1");
    if(d.lt_fuel_rate)localStorage.setItem("lt_fuel_rate",String(d.lt_fuel_rate));
    location.reload();
  }catch(err){alert("Lỗi đọc file sao lưu: "+err.message);}
});

// ── Cuộn ô đang nhập vào tầm nhìn trên mobile ─────────────
document.addEventListener("focusin",e=>{
  if(/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)&&e.target.closest(".modal")){
    setTimeout(()=>e.target.scrollIntoView({block:"center",behavior:"smooth"}),250);
  }
});

// ── Kéo-thả Excel & Phím tắt Desktop ───────────────────────
const dropOv=document.getElementById("drop-overlay");
let dragCnt=0;
window.addEventListener("dragenter",e=>{e.preventDefault();dragCnt++;dropOv.classList.add("show");});
window.addEventListener("dragover",e=>e.preventDefault());
window.addEventListener("dragleave",()=>{dragCnt--;if(dragCnt<=0){dragCnt=0;dropOv.classList.remove("show");}});
window.addEventListener("drop",e=>{
  e.preventDefault();dragCnt=0;dropOv.classList.remove("show");
  const f=e.dataTransfer?.files?.[0];
  if(f&&/\.xlsx?$/i.test(f.name))importExcelFile(f);
});

window.addEventListener("keydown",e=>{
  if(e.key==="Escape"){
    document.querySelectorAll(".modal.open").forEach(m=>m.classList.remove("open"));
  }
  if(e.key==="/"&&!/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)){
    e.preventDefault();document.getElementById("search-input").focus();
  }
});

window.addEventListener("resize",()=>setTimeout(()=>lmap.invalidateSize(),150));

function refreshAll(){buildSchedule();renderUI();renderMap();loadDayExtras();}
refreshAll();
