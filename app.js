// ── Service Worker Offline ─────────────────────────────────
if("serviceWorker" in navigator && location.protocol.startsWith("http")){
  window.addEventListener("load",()=>{
    navigator.serviceWorker.register("./sw.js").catch(()=>{});
  });
}

// ── Hằng số & Helpers ──────────────────────────────────────
const EAR=6371,ROAD=1.35,SVC=30,WS=480,LS=660,LE=780,WE=1020;
const MODES={xemay:{label:"Xe máy",max:4,spd:35},oto:{label:"Ô tô",max:6,spd:40}};
const escHtml=s=>String(s||"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const normVN=s=>String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/đ/g,"d").replace(/Đ/g,"D").toLowerCase().trim();
const parseCoord=v=>{if(v===null||v===undefined||v==="")return NaN;if(typeof v==="number")return v;return parseFloat(String(v).replace(",",".").trim());};
const nowHHMM=()=>{const d=new Date();return String(d.getHours()).padStart(2,"0")+":"+String(d.getMinutes()).padStart(2,"0");};

let toastTimer=null;
function toast(msg){
  const el=document.getElementById("toast");if(!el)return;
  el.textContent=msg;el.classList.add("show");
  clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove("show"),2600);
}

// Modal helpers (tương thích mọi iOS & Android)
function openDlg(id){
  const el=document.getElementById(id);
  if(el)el.classList.add("open");
}
function closeDlg(id){
  const el=document.getElementById(id);
  if(el)el.classList.remove("open");
}

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
    {name:"CH Hội An Center",lon:108.338,lat:15.880,province:"Quảng Nam"},
    {name:"CH Điện Bàn",lon:108.253,lat:15.891,province:"Quảng Nam"},
    {name:"CH Tam Kỳ 1",lon:108.474,lat:15.573,province:"Quảng Nam"},
    {name:"CH Núi Thành",lon:108.647,lat:15.424,province:"Quảng Nam"},
    {name:"CH TP Quảng Ngãi",lon:108.804,lat:15.121,province:"Quảng Ngãi"},
    {name:"CH Đức Phổ",lon:108.958,lat:14.808,province:"Quảng Ngãi"},
    {name:"CH TP Kon Tum",lon:108.007,lat:14.349,province:"Kon Tum"},
    {name:"CH Đăk Hà",lon:107.921,lat:14.521,province:"Kon Tum"},
    {name:"CH Tuy Hòa",lon:109.306,lat:13.095,province:"Phú Yên"}
  ],hotels:[
    {name:"KS Mường Thanh QNam",lon:108.481,lat:15.565,province:"Quảng Nam"},
    {name:"KS Indochine KTum",lon:108.004,lat:14.354,province:"Kon Tum"},
    {name:"KS CenDeluxe TuyHoa",lon:109.310,lat:13.091,province:"Phú Yên"}
  ],precomputed:[]}),
  custom_order:ldj("lt_order",null),
  day_end_points:ldj("lt_day_ends",{}),
  schedule:[],hotels_by_day:{},
  sel_day:1,search:"",status_filter:"all",
  checkins:ldj("lt_ci",{}),
  mode:MODES[initMode]?initMode:"xemay",
  max_shops:Number(localStorage.getItem("lt_max"))||MODES[initMode]?.max||4,
  excel_src:localStorage.getItem("lt_src")||"optimize",
  my_pos:null,duplicates:[]
};

const getCI=name=>{
  const v=st.checkins[name];
  if(!v)return null;
  if(v===true)return{done:true,time:"",note:""};
  return v.done?v:null;
};

// ── Leaflet ─────────────────────────────────────────────────
const esriStreet=L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",{attribution:"© Esri",maxZoom:19});
const esriTopo=L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}",{attribution:"© Esri",maxZoom:19});
const osmLayer=L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png",{attribution:"© OpenStreetMap",maxZoom:19});

const lmap=L.map("map",{zoomControl:true,layers:[esriStreet]}).setView([15,108.4],7);
L.control.layers({"🗺️ Đường phố":esriStreet,"⛰️ Địa hình":esriTopo,"🌐 OpenStreetMap":osmLayer},null,{position:"topright"}).addTo(lmap);
let lmarkers=[],lmarkerByStt={},lpoly=null,myPosMarker=null;

function mkIcon(lbl,color,done){
  const bg=done?"#00a86b":color;
  return L.divIcon({className:"",html:`<div style="background:${bg};border:2px solid #fff;border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:11px;font-weight:700;box-shadow:0 2px 6px rgba(0,0,0,.3);">${escHtml(lbl)}</div>`,iconSize:[28,28],iconAnchor:[14,14],popupAnchor:[0,-16]});
}

function renderMap(){
  lmarkers.forEach(m=>lmap.removeLayer(m)); lmarkers=[]; lmarkerByStt={};
  if(lpoly){lmap.removeLayer(lpoly);lpoly=null;}
  const stops=visibleStops(); if(!stops.length)return;
  const pts=[];
  if(!st.search&&st.status_filter==="all"&&st.sel_day===1&&st.day_end_points[0]?.lat!=null){
    const s0=st.day_end_points[0];
    const sm=L.marker([s0.lat,s0.lon],{icon:mkIcon("S","#2563eb",false)})
      .bindPopup(`<strong>🚩 Xuất phát Ngày 1</strong><br/>${escHtml(s0.name)}`)
      .addTo(lmap);
    lmarkers.push(sm); pts.push([s0.lat,s0.lon]);
  }
  stops.forEach(s=>{
    const ci=getCI(s.name);
    const m=L.marker([s.lat,s.lon],{icon:mkIcon(s.stt,"#0f4c81",!!ci)})
      .bindPopup(`<strong>#${s.stt} ${escHtml(s.name)}</strong><br/>${escHtml(s.province)} · Ngày ${s.day}<br/>⏰ ${escHtml(s.arriveTime)}–${escHtml(s.departTime)}<br/>📍 +${(s.distKm||0).toFixed(1)} km${ci?.note?`<br/>📝 ${escHtml(ci.note)}`:""}<br/><a class="popup-nav" href="${navUrl(s)}" target="_blank">🧭 Chỉ đường Google Maps</a>`)
      .addTo(lmap);
    lmarkers.push(m); lmarkerByStt[s.stt]=m; pts.push([s.lat,s.lon]);
  });
  const h=(!st.search&&st.status_filter==="all"&&st.sel_day!==0)?st.hotels_by_day[st.sel_day]:null;
  if(h?.lat!=null&&h?.lon!=null&&h.type!=="last_shop"){
    const hm=L.marker([h.lat,h.lon],{icon:mkIcon("H","#e67e22",false)})
      .bindPopup(`<strong>🏨 ${escHtml(h.name)}</strong><br/>Cách điểm cuối ~${(h.dist||0).toFixed(1)} km<br/><a class="popup-nav" href="https://www.google.com/maps/dir/?api=1&destination=${h.lat},${h.lon}&travelmode=driving" target="_blank">🧭 Chỉ đường</a>`)
      .addTo(lmap);
    lmarkers.push(hm); pts.push([h.lat,h.lon]);
  }
  if(pts.length>=2&&!st.search&&st.status_filter==="all") lpoly=L.polyline(pts,{color:"#0f4c81",weight:3,opacity:.7,dashArray:"6,4"}).addTo(lmap);
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

// ── GPS (có kiểm tra HTTPS) ─────────────────────────────────
function getGPS(){
  return new Promise((res,rej)=>{
    if(!window.isSecureContext && location.hostname!=="localhost" && location.hostname!=="127.0.0.1"){
      return rej(new Error("GPS chỉ hoạt động khi mở trang qua HTTPS (ví dụ GitHub Pages) hoặc localhost."));
    }
    if(!navigator.geolocation)return rej(new Error("Thiết bị không hỗ trợ GPS."));
    navigator.geolocation.getCurrentPosition(
      p=>res({lat:p.coords.latitude,lon:p.coords.longitude}),
      err=>rej(new Error(err.code===1?"Bạn chưa cấp quyền vị trí GPS cho trình duyệt.":err.code===3?"Hết thời gian chờ tín hiệu GPS.":"Không lấy được tín hiệu GPS.")),
      {enableHighAccuracy:true,timeout:12000,maximumAge:60000}
    );
  });
}

async function locateMeOnMap(){
  try{
    const pos=await getGPS();
    st.my_pos=pos;
    if(myPosMarker)lmap.removeLayer(myPosMarker);
    myPosMarker=L.circleMarker([pos.lat,pos.lon],{radius:8,color:"#fff",weight:3,fillColor:"#2563eb",fillOpacity:1})
      .bindPopup("📍 Vị trí hiện tại của bạn").addTo(lmap);
    lmap.flyTo([pos.lat,pos.lon],13,{duration:.6});
    myPosMarker.openPopup();
  }catch(err){alert(err.message);}
}

// ── Thuật toán ──────────────────────────────────────────────
const hav=(a,b,c,d)=>{const r=x=>x*Math.PI/180,p1=r(a),p2=r(c),dp=r(c-a),dl=r(d-b);let v=Math.sin(dp/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;return 2*EAR*Math.asin(Math.sqrt(Math.min(1,Math.max(0,v))));};
const rdist=(a,b,c,d)=>hav(a,b,c,d)*ROAD;
const rtDist=(idx,items)=>{let t=0;for(let i=0;i<idx.length-1;i++){const a=items[idx[i]],b=items[idx[i+1]];t+=hav(a.lat,a.lon,b.lat,b.lon);}return t;};

function nn(recs,from=null){
  if(!recs.length)return[];
  let si=0;
  if(from){let md=Infinity;recs.forEach((r,i)=>{const d=hav(from.lat,from.lon,r.lat,r.lon);if(d<md){md=d;si=i;}});}
  else recs.forEach((r,i)=>{if(r.lat>recs[si].lat)si=i;});
  const ord=[si],rem=new Set(recs.map((_,i)=>i));rem.delete(si);
  while(rem.size){const l=recs[ord[ord.length-1]];let bi=null,bd=Infinity;for(const i of rem){const d=hav(l.lat,l.lon,recs[i].lat,recs[i].lon);if(d<bd){bd=d;bi=i;}}ord.push(bi);rem.delete(bi);}
  return ord.map(i=>recs[i]);
}

function twoOpt(recs,mx=50){
  if(recs.length<4)return recs;
  let r=recs.map((_,i)=>i),bd=rtDist(r,recs);
  for(let p=0;p<mx;p++){let imp=false;for(let i=1;i<r.length-1;i++){for(let j=i+1;j<r.length;j++){const c=[...r.slice(0,i),...r.slice(i,j+1).reverse(),...r.slice(j+1)];const d=rtDist(c,recs);if(d+1e-9<bd){r=c;bd=d;imp=true;}}}if(!imp)break;}
  return r.map(i=>recs[i]);
}

function routeByProvince(shops,from=null){
  if(!shops.length)return[];
  const provs=[...new Set(shops.map(s=>s.province))];
  let cur;
  if(from){
    let nr=shops[0],md=Infinity;
    for(const s of shops){const d=hav(from.lat,from.lon,s.lat,s.lon);if(d<md){md=d;nr=s;}}
    cur=nr.province;
  }else{
    const north=shops.reduce((b,s)=>s.lat>b.lat?s:b,shops[0]);
    cur=north.province;
  }
  const rem=new Set(provs);rem.delete(cur);
  const out=[];let lp=from;
  while(true){
    let g=shops.filter(s=>s.province===cur);
    g=nn(g,lp);g=twoOpt(g);out.push(...g);
    if(!rem.size)break;
    const ls=g[g.length-1];lp={lat:ls.lat,lon:ls.lon};
    const rs=shops.filter(s=>rem.has(s.province));
    let nr=rs[0],md=Infinity;for(const r of rs){const d=hav(lp.lat,lp.lon,r.lat,r.lon);if(d<md){md=d;nr=r;}}
    cur=nr.province;rem.delete(cur);
  }
  return out;
}

function nearestHotel(s,hotels){
  if(!hotels?.length)return null;
  let best=null,md=Infinity;
  for(const h of hotels){const d=rdist(s.lat,s.lon,h.lat,h.lon);if(d<md){md=d;best={...h,dist:d,type:"hotel"};}}
  return best;
}

function resolveDayEnd(day,lastShop,hotels){
  const ov=st.day_end_points[day];
  if(ov){
    if(ov.type==="last_shop"){
      return{name:lastShop.name,lat:lastShop.lat,lon:lastShop.lon,dist:0,type:"last_shop"};
    }
    if(ov.lat!=null&&ov.lon!=null){
      if(ov.type==="hotel"){
        const mh=hotels.find(h=>h.name===ov.name);
        const h=mh||ov;
        return{name:h.name,lat:h.lat,lon:h.lon,province:h.province||"",dist:rdist(lastShop.lat,lastShop.lon,h.lat,h.lon),type:"hotel"};
      }
      return{name:ov.name||"Điểm tuỳ chỉnh",lat:ov.lat,lon:ov.lon,dist:rdist(lastShop.lat,lastShop.lon,ov.lat,ov.lon),type:"custom"};
    }
  }
  return nearestHotel(lastShop,hotels);
}

const fmt=m=>{const v=Math.round(m);return String(Math.floor(v/60)).padStart(2,"0")+":"+String(v%60).padStart(2,"0");};

function adv(cur,travel){
  let t=cur;
  if(t>=LS&&t<LE)t=LE;
  if(t<LS&&t+travel+SVC>LS){const md=Math.max(0,LS-t);t=LE+Math.max(0,travel-md);}
  else t+=travel;
  return{arrive:t,depart:t+SVC};
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

function buildSchedule(customOrder=null){
  const{shops,hotels,precomputed}=st.raw;
  findDuplicates(shops.length?shops:precomputed);
  if(customOrder){
    st.custom_order=customOrder.map(s=>s.name);
    localStorage.setItem("lt_order",JSON.stringify(st.custom_order));
  }
  if(!customOrder&&!st.custom_order&&precomputed?.length&&st.excel_src==="lichtrinh"){
    st.schedule=precomputed;st.hotels_by_day={};
    precomputed.forEach(x=>{
      if(x.nightHotel){
        const mh=hotels.find(h=>h.name===x.nightHotel);
        st.hotels_by_day[x.day]={name:x.nightHotel,dist:x.hotelDist||0,lat:mh?.lat,lon:mh?.lon,type:"hotel"};
      }
    });
    return;
  }
  let ordered;
  if(customOrder){
    ordered=customOrder;
  }else if(st.custom_order?.length){
    const pool=shops.length?shops:precomputed;
    const map=new Map(pool.map(s=>[s.name,{...s}]));
    ordered=[];const used=new Set();
    st.custom_order.forEach(n=>{if(map.has(n)){ordered.push(map.get(n));used.add(n);}});
    pool.forEach(s=>{if(!used.has(s.name))ordered.push({...s});});
  }else{
    ordered=routeByProvince(shops.map(s=>({...s})),st.day_end_points[0]||null);
  }

  const prof=MODES[st.mode]||MODES.xemay;
  const mx=st.max_shops||prof.max;
  const sch=[],hbd={};let day=1,cnt=0,cur=WS,prev=null;
  ordered.forEach((s,idx)=>{
    if(idx===0){
      const sp0=st.day_end_points[0];
      if(sp0?.lat!=null&&sp0?.lon!=null){
        const d0=rdist(sp0.lat,sp0.lon,s.lat,s.lon);
        const m0=(d0/prof.spd)*60;const o0=adv(WS,m0);
        sch.push({...s,stt:1,day,distKm:d0,arriveTime:fmt(o0.arrive),departTime:fmt(o0.depart)});
        cur=o0.depart;
      }else{
        sch.push({...s,stt:1,day,distKm:0,arriveTime:fmt(WS),departTime:fmt(WS+SVC)});
        cur=WS+SVC;
      }
      cnt=1;prev=s;return;
    }
    const dist=rdist(prev.lat,prev.lon,s.lat,s.lon);
    const tmn=(dist/prof.spd)*60;const cand=adv(cur,tmn);
    if(cnt>=mx||cand.depart>WE){
      hbd[day]=resolveDayEnd(day,sch[sch.length-1],hotels);
      day++;cnt=1;
      const sp=hbd[day-1]||sch[sch.length-1];
      const md=rdist(sp.lat,sp.lon,s.lat,s.lon);const mm=(md/prof.spd)*60;const mo=adv(WS,mm);
      sch.push({...s,stt:idx+1,day,distKm:md,arriveTime:fmt(mo.arrive),departTime:fmt(mo.depart)});
      cur=mo.depart;prev=s;
    }else{
      sch.push({...s,stt:idx+1,day,distKm:dist,arriveTime:fmt(cand.arrive),departTime:fmt(cand.depart)});
      cur=cand.depart;cnt++;prev=s;
    }
  });
  if(sch.length)hbd[day]=resolveDayEnd(day,sch[sch.length-1],hotels);
  st.schedule=sch;st.hotels_by_day=hbd;
}

// ── Đọc, Xuất & Tải Mẫu Excel ──────────────────────────────
async function importExcelFile(f){
  if(!f)return;
  if(typeof XLSX==="undefined"){alert("Chưa tải được thư viện đọc Excel. Vui lòng kiểm tra kết nối mạng rồi tải lại trang.");return;}
  try{
    const buf=await f.arrayBuffer();const wb=XLSX.read(buf,{type:"array"});
    const tr=n=>wb.Sheets[n]?XLSX.utils.sheet_to_json(wb.Sheets[n],{defval:null}):[];
    const rawShops=tr("CuaHang").map(r=>({name:String(r["Tên cửa hàng"]||"").trim(),lon:parseCoord(r["kinh độ"]),lat:parseCoord(r["vĩ độ"]),province:String(r["tỉnh"]||"").trim()})).filter(s=>s.name&&s.province&&!isNaN(s.lon)&&!isNaN(s.lat));
    const rawHotels=tr("KhachSan").map(r=>({name:String(r["Tên khách sạn"]||"").trim(),lon:parseCoord(r["kinh độ"]),lat:parseCoord(r["vĩ độ"]),province:String(r["tỉnh"]||"").trim()})).filter(h=>h.name&&!isNaN(h.lon)&&!isNaN(h.lat));
    const ltRows=tr("LichTrinh");
    const rawPre=ltRows.map((r,i)=>({
      stt:Number(r["STT"])||i+1,day:Number(r["Ngày"])||1,name:String(r["Tên cửa hàng"]||"").trim(),
      province:String(r["tỉnh"]||"").trim(),lon:parseCoord(r["kinh độ"]),lat:parseCoord(r["vĩ độ"]),
      distKm:parseCoord(r["Quãng đường (km)"])||0,nightHotel:r["Nghỉ đêm tại"]?String(r["Nghỉ đêm tại"]).trim():null,
      hotelDist:parseCoord(r["Cách khách sạn (km)"])||0,
      arriveTime:r["Giờ đến"]?String(r["Giờ đến"]).trim():"--:--",
      departTime:r["Giờ đi"]?String(r["Giờ đi"]).trim():"--:--",
      _ciStatus:String(r["Trạng thái Check-in"]||"").trim(),
      _ciTime:String(r["Giờ Check-in"]||"").trim(),
      _ciNote:String(r["Ghi chú"]||"").trim()
    })).filter(s=>s.name&&s.name!=="Nghỉ ngơi"&&!isNaN(s.lat)&&!isNaN(s.lon));
    if(!rawShops.length&&!rawPre.length){alert("Không đọc được dữ liệu (cần sheet CuaHang hoặc LichTrinh)!");return;}

    if(Object.keys(st.checkins).length>0){
      if(confirm("Bạn có muốn xoá toàn bộ trạng thái Check-in & ghi chú cũ trước khi nạp file Excel mới không?\n\n• OK: Xoá cũ, dùng dữ liệu mới sạch sẽ\n• Huỷ: Giữ lại Check-in cũ nếu trùng tên")){
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
      shops=precomputed.map(p=>({name:p.name,lon:p.lon,lat:p.lat,province:p.province}));
    }

    dPre.items.forEach(r=>{
      if(r._ciStatus==="Đã ghé"||r._ciStatus==="✓"||r._ciStatus==="true"){
        st.checkins[r.name]={done:true,time:r._ciTime,note:r._ciNote};
      }
    });
    localStorage.setItem("lt_ci",JSON.stringify(st.checkins));

    st.raw={shops,hotels,precomputed};
    st.custom_order=null;
    st.day_end_points={};
    localStorage.removeItem("lt_order");
    localStorage.removeItem("lt_day_ends");
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
    return{
      "STT":s.stt,"Ngày":s.day,"Tên cửa hàng":s.name,"tỉnh":s.province,"vĩ độ":s.lat,"kinh độ":s.lon,
      "Quãng đường (km)":Number((s.distKm||0).toFixed(2)),"Giờ đến":s.arriveTime,"Giờ đi":s.departTime,
      "Nghỉ đêm tại":h?h.name:"","Cách khách sạn (km)":h?Number((h.dist||0).toFixed(2)):"",
      "Trạng thái Check-in":ci?"Đã ghé":"Chưa ghé","Giờ Check-in":ci?.time||"","Ghi chú":ci?.note||""
    };
  });
  const srcShops=st.raw.shops.length?st.raw.shops:st.schedule;
  const chData=srcShops.map(s=>({"Tên cửa hàng":s.name,"tỉnh":s.province,"vĩ độ":s.lat,"kinh độ":s.lon}));
  const ksData=st.raw.hotels.map(h=>({"Tên khách sạn":h.name,"tỉnh":h.province,"vĩ độ":h.lat,"kinh độ":h.lon}));

  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(ltData),"LichTrinh");
  XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(chData),"CuaHang");
  XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(ksData),"KhachSan");
  XLSX.writeFile(wb,`LoTrinh_KinhDoanh_${new Date().toISOString().slice(0,10)}.xlsx`);
  toast("📤 Đã xuất file Excel!");
}

function downloadSampleExcel(){
  if(typeof XLSX==="undefined"){alert("Chưa tải được thư viện Excel.");return;}
  const ch=[
    {"Tên cửa hàng":"CH Hội An Center","tỉnh":"Quảng Nam","vĩ độ":15.880,"kinh độ":108.338},
    {"Tên cửa hàng":"CH Tam Kỳ 1","tỉnh":"Quảng Nam","vĩ độ":15.573,"kinh độ":108.474},
    {"Tên cửa hàng":"CH TP Kon Tum","tỉnh":"Kon Tum","vĩ độ":14.349,"kinh độ":108.007}
  ];
  const ks=[
    {"Tên khách sạn":"KS Mường Thanh QNam","tỉnh":"Quảng Nam","vĩ độ":15.565,"kinh độ":108.481}
  ];
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(ch),"CuaHang");
  XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(ks),"KhachSan");
  XLSX.writeFile(wb,"Mau_Data_LoTrinh.xlsx");
  toast("📋 Đã tải file Excel mẫu!");
}

// ── THÊM / SỬA / XOÁ ĐIỂM ───────────────────────────────────
let ptType="shop",editTarget=null,miniMap=null,miniMarker=null,suggestHits=[];

function setPointType(t){
  ptType=t;
  document.getElementById("pt-type-shop").classList.toggle("active",t==="shop");
  document.getElementById("pt-type-hotel").classList.toggle("active",t==="hotel");
  document.getElementById("pt-dlg-title").textContent=editTarget?(t==="shop"?"✏️ Sửa Cửa Hàng":"✏️ Sửa Khách Sạn"):(t==="shop"?"➕ Thêm Cửa Hàng":"🏨 Thêm Khách Sạn");
  document.getElementById("pt-suggest").style.display="none";
}

function syncMiniMap(cLat,cLon,zoom,hasPin){
  if(!miniMap){
    miniMap=L.map("add-mini-map",{zoomControl:false}).setView([cLat,cLon],zoom);
    L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",{maxZoom:19}).addTo(miniMap);
    miniMap.on("click",e=>setMiniPin(e.latlng.lat,e.latlng.lng));
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
  document.getElementById("pt-province").value=editItem?editItem.province:"";
  document.getElementById("pt-lat").value=editItem?editItem.lat:"";
  document.getElementById("pt-lon").value=editItem?editItem.lon:"";
  document.getElementById("pt-suggest").style.display="none";
  document.getElementById("pt-save-btn").textContent=editItem?"💾 Lưu thay đổi":"✅ Thêm vào danh sách";
  document.getElementById("pt-del-btn").style.display=editItem?"inline-block":"none";
  openDlg("point-dialog");

  const hasPin=Boolean(editItem?.lat!=null&&editItem?.lon!=null);
  syncMiniMap(hasPin?editItem.lat:15,hasPin?editItem.lon:108.4,hasPin?13:7,hasPin);
}

function setMiniPin(lat,lon){
  document.getElementById("pt-lat").value=Number(lat).toFixed(6);
  document.getElementById("pt-lon").value=Number(lon).toFixed(6);
  if(!document.getElementById("pt-province").value){
    const prov=guessProv(lat,lon);
    if(prov)document.getElementById("pt-province").value=prov;
  }
  if(miniMap){
    if(miniMarker)miniMap.removeLayer(miniMarker);
    miniMarker=L.marker([lat,lon]).addTo(miniMap);
    miniMap.setView([lat,lon],Math.max(miniMap.getZoom(),13),{animate:false});
  }
}

async function fillPointGPS(){
  const btn=document.getElementById("btn-pt-gps");
  const old=btn.textContent;btn.textContent="⏳ Đang lấy GPS...";btn.disabled=true;
  try{
    const pos=await getGPS();
    st.my_pos=pos;
    setMiniPin(pos.lat,pos.lon);
    toast("📍 Đã lấy tọa độ GPS hiện tại");
  }catch(err){alert(err.message);}
  finally{btn.textContent=old;btn.disabled=false;}
}

function guessProv(lat,lon){
  if(lat>15.5)return"Quảng Nam";
  if(lat>14.9)return"Quảng Ngãi";
  if(lon<108.2&&lat>14.0)return"Kon Tum";
  if(lat>13.5)return"Bình Định";
  return"Phú Yên";
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
  document.getElementById("pt-province").value=x.province;
  setMiniPin(x.lat,x.lon);
  document.getElementById("pt-suggest").style.display="none";
}

function savePoint(){
  const name=document.getElementById("pt-name").value.trim();
  const prov=document.getElementById("pt-province").value.trim();
  const lat=parseCoord(document.getElementById("pt-lat").value);
  const lon=parseCoord(document.getElementById("pt-lon").value);
  if(!name){alert("Vui lòng nhập tên!");return;}
  if(!prov){alert("Vui lòng nhập tỉnh!");return;}
  if(isNaN(lat)||isNaN(lon)){alert("Vui lòng chọn vị trí trên bản đồ, bấm GPS hoặc nhập tọa độ hợp lệ!");return;}

  const list=ptType==="shop"?st.raw.shops:st.raw.hotels;
  if(editTarget){
    const idx=list.findIndex(x=>x.name===editTarget.name);
    if(idx===-1){alert("Không tìm thấy mục cần sửa!");return;}
    if(name!==editTarget.name&&list.some(x=>x.name===name)){alert("Tên mới bị trùng với mục khác!");return;}
    list[idx]={name,lat,lon,province:prov};
    if(ptType==="shop"&&name!==editTarget.name){
      if(st.checkins[editTarget.name]){st.checkins[name]=st.checkins[editTarget.name];delete st.checkins[editTarget.name];localStorage.setItem("lt_ci",JSON.stringify(st.checkins));}
      if(st.custom_order){st.custom_order=st.custom_order.map(n=>n===editTarget.name?name:n);localStorage.setItem("lt_order",JSON.stringify(st.custom_order));}
    }
    toast(`💾 Đã cập nhật "${name}"`);
  }else{
    if(list.some(x=>x.name===name)){alert((ptType==="shop"?"Cửa hàng":"Khách sạn")+" đã tồn tại!");return;}
    list.push({name,lat,lon,province:prov});
    if(ptType==="shop"&&st.custom_order){st.custom_order.push(name);localStorage.setItem("lt_order",JSON.stringify(st.custom_order));}
    toast(`✅ Đã thêm "${name}"`);
  }

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
  }else{
    st.raw.hotels=st.raw.hotels.filter(h=>h.name!==editTarget.name);
  }
  localStorage.setItem("lt_raw",JSON.stringify(st.raw));
  closeDlg("point-dialog");
  st.sel_day=1;refreshAll();
  toast(`🗑️ Đã xoá "${editTarget.name}"`);
}

function moveStop(stt,dir){
  const idx=st.schedule.findIndex(s=>s.stt===stt);
  const target=idx+dir;
  if(idx<0||target<0||target>=st.schedule.length)return;
  const movedName=st.schedule[idx].name;
  const oldDay=st.schedule[idx].day;
  const names=st.schedule.map(s=>s.name);
  [names[idx],names[target]]=[names[target],names[idx]];
  const pool=st.raw.shops.length?st.raw.shops:st.raw.precomputed;
  const map=new Map(pool.map(s=>[s.name,{name:s.name,lat:s.lat,lon:s.lon,province:s.province}]));
  const ordered=names.map(n=>map.get(n)).filter(Boolean);
  if(!ordered.length)return;
  st.excel_src="optimize";localStorage.setItem("lt_src","optimize");
  buildSchedule(ordered);
  const movedStop=st.schedule.find(s=>s.name===movedName);
  if(movedStop&&st.sel_day!==0&&movedStop.day!==oldDay){
    st.sel_day=movedStop.day;
    toast(`📅 "${movedName}" đã chuyển sang Ngày ${movedStop.day}`);
  }else{
    toast(dir<0?"⬆️ Đã đẩy lên 1 bậc":"⬇️ Đã đẩy xuống 1 bậc");
  }
  renderUI();renderMap();
}

// ── ĐỔI ĐIỂM CUỐI NGÀY / ĐIỂM BẮT ĐẦU NGÀY SAU ─────────────
let deTargetDay=1,deMiniMap=null,deMiniMarker=null;

function openDayEndDialog(day){
  deTargetDay=day;
  const isDay1Start=(day===0);
  document.getElementById("de-dlg-title").textContent=isDay1Start?"🚩 Điểm xuất phát Ngày 1":`📍 Điểm cuối Ngày ${day} → Bắt đầu Ngày ${day+1}`;
  document.getElementById("de-desc").textContent=isDay1Start?"Chọn điểm xuất phát cho buổi sáng Ngày 1 (mặc định 08:00 tại điểm #1).":`Chọn điểm nghỉ đêm / kết thúc Ngày ${day}. Sáng Ngày ${day+1} sẽ xuất phát từ điểm này.`;

  const modeSel=document.getElementById("de-mode");
  if(isDay1Start){
    modeSel.innerHTML=`
      <option value="default">Mặc định (bắt đầu ngay tại điểm #1 lúc 08:00)</option>
      <option value="hotel">Xuất phát từ một Khách sạn</option>
      <option value="custom">Điểm tuỳ chỉnh (GPS / Bản đồ / Toạ độ)</option>`;
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

function saveDayEnd(){
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
      st.raw.hotels.push({name,lat,lon,province:guessProv(lat,lon)});
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
  closeDlg("settings-dialog");
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
        <div style="font-size:12px;color:var(--muted);">${escHtml(h.province)} · ${h.lat.toFixed(4)}, ${h.lon.toFixed(4)}</div>
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

// ── CHECK-IN & GHI CHÚ ─────────────────────────────────────
let noteShopName=null;

function toggleCheckin(stt){
  const s=st.schedule.find(x=>x.stt===stt);if(!s)return;
  if(getCI(s.name)){delete st.checkins[s.name];toast(`⬜ Bỏ Check-in: ${s.name}`);}
  else{const t=nowHHMM();st.checkins[s.name]={done:true,time:t,note:""};toast(`✅ Đã Check-in ${s.name} (${t})`);}
  localStorage.setItem("lt_ci",JSON.stringify(st.checkins));
  renderUI();renderMap();
}

function openNoteDialog(stt){
  const s=st.schedule.find(x=>x.stt===stt);if(!s)return;
  noteShopName=s.name;
  const ci=getCI(s.name);
  document.getElementById("note-shop-name").textContent=s.name;
  document.getElementById("note-shop-time").textContent=ci?.time?`Đã check-in lúc ${ci.time}`:"Sẽ tự động đánh dấu Check-in khi lưu";
  document.getElementById("note-text").value=ci?.note||"";
  openDlg("note-dialog");
}

function saveNote(){
  if(!noteShopName)return;
  const existing=getCI(noteShopName);
  const note=document.getElementById("note-text").value.trim();
  st.checkins[noteShopName]={done:true,time:existing?.time||nowHHMM(),note};
  localStorage.setItem("lt_ci",JSON.stringify(st.checkins));
  closeDlg("note-dialog");
  renderUI();renderMap();
  toast("📝 Đã lưu ghi chú!");
}

function uncheckFromNote(){
  if(!noteShopName)return;
  delete st.checkins[noteShopName];
  localStorage.setItem("lt_ci",JSON.stringify(st.checkins));
  closeDlg("note-dialog");
  renderUI();renderMap();
  toast("⬜ Đã huỷ Check-in");
}

// ── TỐI ƯU TUYẾN ───────────────────────────────────────────
function openOptimize(){
  const sel=document.getElementById("opt-start");
  sel.innerHTML='<option value="">-- Mặc định (KS ngày trước / điểm đầu) --</option><option value="__GPS__">📍 Vị trí GPS hiện tại của tôi</option>';
  st.raw.hotels.forEach(h=>{sel.innerHTML+=`<option value="${escHtml(h.name)}">${escHtml(h.name)} (KS)</option>`;});
  const sd=document.getElementById("opt-day");
  const totalDays=st.schedule.reduce((m,s)=>Math.max(m,s.day),0);
  sd.innerHTML='<option value="0">Toàn bộ lịch trình</option>';
  for(let d=1;d<=totalDays;d++) sd.innerHTML+=`<option value="${d}">Chỉ ngày ${d}</option>`;
  document.getElementById("opt-info").innerHTML='Nhấn <strong>Chạy tối ưu</strong> để phân tích, sắp xếp và lưu lại tuyến đường tốt nhất.';
  openDlg("opt-dialog");
}

async function runOptimize(){
  const startVal=document.getElementById("opt-start").value;
  const selDay=parseInt(document.getElementById("opt-day").value,10);
  const algo=document.getElementById("opt-algo").value;
  const btn=document.getElementById("btn-run-opt");

  let from=null;
  if(startVal==="__GPS__"){
    const old=btn.textContent;btn.textContent="⏳ Đang lấy GPS...";btn.disabled=true;
    try{
      const pos=await getGPS();
      st.my_pos=pos;
      from={lat:pos.lat,lon:pos.lon};
      st.day_end_points[selDay>0?selDay-1:0]={type:"custom",name:"Vị trí GPS",lat:pos.lat,lon:pos.lon};
      localStorage.setItem("lt_day_ends",JSON.stringify(st.day_end_points));
    }catch(err){alert(err.message);btn.textContent=old;btn.disabled=false;return;}
    btn.textContent=old;btn.disabled=false;
  }else if(startVal){
    const h=st.raw.hotels.find(x=>x.name===startVal);
    if(h){
      from={lat:h.lat,lon:h.lon};
      st.day_end_points[selDay>0?selDay-1:0]={type:"hotel",name:h.name,lat:h.lat,lon:h.lon,province:h.province};
      localStorage.setItem("lt_day_ends",JSON.stringify(st.day_end_points));
    }
  }else if(selDay>1&&st.hotels_by_day[selDay-1]){
    const prevEnd=st.hotels_by_day[selDay-1];
    if(prevEnd.lat!=null&&prevEnd.lon!=null)from={lat:prevEnd.lat,lon:prevEnd.lon};
  }else if(selDay<=1&&st.day_end_points[0]?.lat!=null){
    from={lat:st.day_end_points[0].lat,lon:st.day_end_points[0].lon};
  }

  const shops=(st.raw.shops.length?st.raw.shops:st.raw.precomputed).map(s=>({...s}));
  const before=st.schedule.reduce((s,x)=>s+(x.distKm||0),0);

  let ordered;
  if(selDay>0){
    const dayShops=st.schedule.filter(s=>s.day===selDay).map(s=>shops.find(x=>x.name===s.name)||s);
    const optDay=algo==="province"?routeByProvince(dayShops,from):twoOpt(nn(dayShops,from));
    const prevDays=st.schedule.filter(s=>s.day<selDay).map(s=>shops.find(x=>x.name===s.name)||s);
    const nextDays=st.schedule.filter(s=>s.day>selDay).map(s=>shops.find(x=>x.name===s.name)||s);
    ordered=[...prevDays,...optDay,...nextDays];
  }else{
    ordered=algo==="province"?routeByProvince(shops,from):twoOpt(nn(shops,from));
  }

  st.excel_src="optimize";
  localStorage.setItem("lt_src","optimize");
  buildSchedule(ordered);

  const after=st.schedule.reduce((s,x)=>s+(x.distKm||0),0);
  const saved=before-after;
  const pct=before>0?Math.round((saved/before)*100):0;
  const totalDays=st.schedule.reduce((m,s)=>Math.max(m,s.day),0);

  document.getElementById("opt-info").innerHTML=
    `<strong>✅ Đã tối ưu & lưu lịch trình!</strong><br/>
    📍 Tổng điểm: ${st.schedule.length} cửa hàng · ${totalDays} ngày<br/>
    🛣️ Trước: ~${before.toFixed(1)} km → Sau: ~${after.toFixed(1)} km<br/>
    <strong style="color:var(--acc);">💚 ${saved>=0?"Tiết kiệm":"Chênh lệch"}: ~${Math.abs(saved).toFixed(1)} km (${pct}%)</strong>`;

  st.sel_day=selDay>0?selDay:1;
  renderUI();renderMap();
}

// ── Tìm kiếm, Lọc & Navigate ────────────────────────────────
function onSearchInput(){
  st.search=document.getElementById("search-input").value;
  document.getElementById("search-clear").style.display=st.search?"block":"none";
  renderUI();renderMap();
}
function clearSearch(){
  document.getElementById("search-input").value="";
  st.search="";
  document.getElementById("search-clear").style.display="none";
  renderUI();renderMap();
}
function onFilterChange(){
  st.status_filter=document.getElementById("filter-status").value;
  renderUI();renderMap();
}

const navUrl=s=>`https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lon}&travelmode=driving`;

function baseStops(){
  const q=normVN(st.search);
  if(q)return st.schedule.filter(s=>normVN(s.name).includes(q)||normVN(s.province).includes(q));
  return st.sel_day===0?st.schedule:st.schedule.filter(s=>s.day===st.sel_day);
}

function visibleStops(){
  const list=baseStops();
  if(st.status_filter==="todo")return list.filter(s=>!getCI(s.name));
  if(st.status_filter==="done")return list.filter(s=>!!getCI(s.name));
  return list;
}

function navigateNext(){
  const stops=visibleStops();
  const nx=stops.find(s=>!getCI(s.name))||stops[0];
  if(nx)window.open(navUrl(nx),"_blank");
}

function navigateDay(){
  const stops=visibleStops();if(!stops.length)return;
  if(stops.length===1){window.open(navUrl(stops[0]),"_blank");return;}
  if(stops.length>10&&!confirm(`Đang có ${stops.length} điểm. Khi dẫn đường từ GPS hiện tại, Google Maps hỗ trợ tối đa 10 điểm dừng trên 1 tuyến.\n\nBạn có muốn mở 10 điểm đầu tiên không? (Mẹo: chọn từng Ngày để đi hết lộ trình)`))return;
  const sl=stops.slice(0,10);
  const dest=sl[sl.length-1];
  const wp=sl.slice(0,-1).map(s=>`${s.lat},${s.lon}`).join("|");
  window.open(`https://www.google.com/maps/dir/?api=1&destination=${dest.lat},${dest.lon}${wp?`&waypoints=${encodeURIComponent(wp)}`:""}&travelmode=driving`,"_blank");
}

// ── Render UI ───────────────────────────────────────────────
function switchMode(m){if(!MODES[m])return;st.mode=m;st.max_shops=MODES[m].max;localStorage.setItem("lt_mode",m);localStorage.setItem("lt_max",String(st.max_shops));st.sel_day=1;refreshAll();}
function selectDay(d){st.sel_day=d;clearSearch();renderUI();renderMap();}

function renderUI(){
  const prof=MODES[st.mode]||MODES.xemay;
  const totalDays=st.schedule.reduce((m,s)=>Math.max(m,s.day),0);
  const base=baseStops();
  const vis=visibleStops();
  const vkm=vis.reduce((s,x)=>s+(x.distKm||0),0);

  document.getElementById("btn-xemay").classList.toggle("active",st.mode==="xemay");
  document.getElementById("btn-oto").classList.toggle("active",st.mode==="oto");
  document.getElementById("sub-title").textContent=`${prof.label} ${prof.spd}km/h · max ${st.max_shops} điểm/ngày`;
  document.getElementById("stat-shops").textContent=`${vis.length} điểm`;
  document.getElementById("stat-days").textContent=`${totalDays} ngày`;
  document.getElementById("stat-km").textContent=`~${vkm.toFixed(1)} km`;

  const dupEl=document.getElementById("stat-dup");
  if(st.duplicates.length){dupEl.style.display="inline-block";dupEl.textContent=`⚠️ ${st.duplicates.length} trùng`;}
  else dupEl.style.display="none";

  const doneCnt=base.filter(s=>!!getCI(s.name)).length;
  const pct=base.length?Math.round((doneCnt/base.length)*100):0;
  document.getElementById("prog-txt").textContent=`✅ ${doneCnt}/${base.length}`;
  document.getElementById("prog-fill").style.width=pct+"%";

  const te=document.getElementById("day-tabs");
  let th=`<button class="day-tab ${st.sel_day===0&&!st.search?"active":""}" onclick="selectDay(0)">Tất cả (${st.schedule.length})</button>`;
  for(let d=1;d<=totalDays;d++){const c=st.schedule.filter(s=>s.day===d).length;th+=`<button class="day-tab ${st.sel_day===d&&!st.search?"active":""}" onclick="selectDay(${d})">Ngày ${d} (${c})</button>`;}
  te.innerHTML=th;

  const le=document.getElementById("schedule-list");
  let html="";

  if(!st.search&&st.status_filter==="all"&&st.sel_day===1&&vis.length){
    const s0=st.day_end_points[0];
    html+=`<div class="start-strip">
      <span>🚩 Xuất phát: <strong>${s0?.name?escHtml(s0.name):"Mặc định (tại điểm #1)"}</strong></span>
      <button class="btn-sm compact" onclick="openDayEndDialog(0)">📍 Đổi</button>
    </div>`;
  }

  vis.forEach(s=>{
    const ci=getCI(s.name);
    html+=`<div class="shop-card${ci?" done":""}">
      <div class="shop-top" onclick="focusStop(${s.stt})">
        <span class="badge">${s.stt}</span>
        <div class="shop-info">
          <strong>${escHtml(s.name)}</strong>
          <div class="shop-meta">${escHtml(s.province)} · Ngày ${s.day} · +${(s.distKm||0).toFixed(1)} km</div>
          ${ci?.note?`<div class="shop-note">📝 ${escHtml(ci.note)}</div>`:""}
        </div>
        <span class="shop-time">${escHtml(s.arriveTime)}–${escHtml(s.departTime)}</span>
      </div>
      <div class="shop-acts">
        <a class="btn-sm green" href="${navUrl(s)}" target="_blank">🧭 Đường</a>
        <button class="btn-sm${ci?" checked":""}" onclick="toggleCheckin(${s.stt})">${ci?`✅ ${ci.time||"Đã ghé"}`:"⬜ Check-in"}</button>
        <button class="btn-sm compact" title="Ghi chú" onclick="openNoteDialog(${s.stt})">📝</button>
        <button class="btn-sm compact" title="Sửa / Xoá" onclick="editShopByStt(${s.stt})">✏️</button>
        <button class="btn-sm compact" title="Đẩy lên" onclick="moveStop(${s.stt},-1)">▲</button>
        <button class="btn-sm compact" title="Đẩy xuống" onclick="moveStop(${s.stt},1)">▼</button>
      </div>
    </div>`;
  });

  if(!st.search&&st.status_filter==="all"&&st.sel_day!==0&&vis.length){
    const h=st.hotels_by_day[st.sel_day];
    const hasNext=st.sel_day<totalDays;
    const subTxt=h?(h.type==="last_shop"?"Tại cửa hàng cuối ngày":`~${(h.dist||0).toFixed(1)} km từ điểm cuối`):"Tại điểm cuối cùng của ngày";
    const hu=h?.lat!=null?`https://www.google.com/maps/dir/?api=1&destination=${h.lat},${h.lon}&travelmode=driving`:"#";
    const hIdx=h?st.raw.hotels.findIndex(x=>x.name===h.name):-1;
    html+=`<div class="shop-card hotel-card">
      <div class="shop-top">
        <span class="badge hotel">H</span>
        <div class="shop-info">
          <strong>${h?.type==="last_shop"?"📌":"🏨"} ${escHtml(h?.name||vis[vis.length-1].name)}</strong>
          <div class="shop-meta">${hasNext?`Điểm cuối Ngày ${st.sel_day} & Bắt đầu Ngày ${st.sel_day+1}`:`Kết thúc Ngày ${st.sel_day}`} · ${subTxt}</div>
        </div>
        <span class="shop-time hotel">${hasNext?`Bắt đầu N${st.sel_day+1}`:"Nghỉ đêm"}</span>
      </div>
      <div class="shop-acts">
        ${h?.lat!=null&&h.type!=="last_shop"?`<a class="btn-sm green" href="${hu}" target="_blank">🧭 Đường</a>`:""}
        <button class="btn-sm" onclick="openDayEndDialog(${st.sel_day})">📍 Đổi điểm cuối${hasNext?` / BĐ N${st.sel_day+1}`:""}</button>
        ${hIdx>=0?`<button class="btn-sm compact" title="Sửa KS" onclick="editHotel(${hIdx})">✏️</button><button class="btn-sm compact red" title="Xoá KS" onclick="deleteHotel(${hIdx})">🗑️</button>`:""}
      </div>
    </div>`;
  }

  le.innerHTML=html||`<div style="text-align:center;padding:40px 16px;color:var(--muted);">
    <div style="font-size:36px;margin-bottom:12px;">🗺️</div>
    <div style="font-weight:600;margin-bottom:6px;">${st.search||st.status_filter!=="all"?"Không có điểm phù hợp bộ lọc":"Chưa có dữ liệu"}</div>
    <div style="font-size:13px;">${st.search||st.status_filter!=="all"?"Thử đổi bộ lọc hoặc xoá từ khóa tìm kiếm":"Nhấn 📂 Nhập để nạp Excel hoặc ➕ Điểm để thêm mới"}</div>
  </div>`;
}

function editShopByStt(stt){
  const item=st.schedule.find(s=>s.stt===stt);if(!item)return;
  const rawShop=st.raw.shops.find(s=>s.name===item.name)||item;
  openPointDialog("shop",rawShop);
}

// ── Cài đặt ────────────────────────────────────────────────
function openSettings(){
  document.getElementById("cfg-mode").value=st.mode;
  document.getElementById("cfg-max").value=st.max_shops;
  document.getElementById("cfg-src").value=st.excel_src;
  document.getElementById("cfg-hotel-cnt").textContent=st.raw.hotels.length;
  openDlg("settings-dialog");
}
function onCfgModeChange(){const m=document.getElementById("cfg-mode").value;document.getElementById("cfg-max").value=MODES[m]?.max||4;}
function saveSettings(){
  st.mode=document.getElementById("cfg-mode").value;
  const mv=parseInt(document.getElementById("cfg-max").value,10);
  st.max_shops=mv>0?mv:(MODES[st.mode]?.max||4);
  st.excel_src=document.getElementById("cfg-src").value;
  localStorage.setItem("lt_mode",st.mode);localStorage.setItem("lt_max",String(st.max_shops));localStorage.setItem("lt_src",st.excel_src);
  closeDlg("settings-dialog");
  st.sel_day=1;refreshAll();
  toast("⚙️ Đã lưu cài đặt");
}
function resetData(){
  if(!confirm("Reset toàn bộ dữ liệu, điểm xuất phát và thứ tự tối ưu?"))return;
  localStorage.removeItem("lt_raw");
  localStorage.removeItem("lt_order");
  localStorage.removeItem("lt_day_ends");
  location.reload();
}
function clearCheckins(){
  if(!confirm("Xoá toàn bộ Check-in & ghi chú?"))return;
  st.checkins={};localStorage.removeItem("lt_ci");
  closeDlg("settings-dialog");refreshAll();
  toast("🧹 Đã xoá toàn bộ Check-in");
}

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

function refreshAll(){buildSchedule();renderUI();renderMap();}
refreshAll();
