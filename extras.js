// ── Lịch Dương, Lịch Âm Việt Nam (UTC+7) & Ngày Lễ ──────────
function toLocalIso(d=new Date()){
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function parseIsoDate(iso){
  if(!iso||!/^\d{4}-\d{2}-\d{2}$/.test(iso))return new Date();
  const[y,m,d]=iso.split("-").map(Number);
  return new Date(y,m-1,d);
}
function daysBetweenIso(a,b){
  const d1=parseIsoDate(a),d2=parseIsoDate(b);
  d1.setHours(0,0,0,0);d2.setHours(0,0,0,0);
  return Math.round((d2-d1)/86400000);
}

// Thuật toán Âm lịch Hồ Ngọc Đức
const PI=Math.PI;
function jdFromDate(dd,mm,yy){
  const a=Math.floor((14-mm)/12),y=yy+4800-a,m=mm+12*a-3;
  let jd=dd+Math.floor((153*m+2)/5)+365*y+Math.floor(y/4)-Math.floor(y/100)+Math.floor(y/400)-32045;
  if(jd<2299161)jd=dd+Math.floor((153*m+2)/5)+365*y+Math.floor(y/4)-32083;
  return jd;
}
function NewMoon(k){
  const T=k/1236.85,T2=T*T,T3=T2*T,dr=PI/180;
  let Jd1=2415020.75933+29.53058868*k+0.0001178*T2-0.000000155*T3;
  Jd1+=0.00033*Math.sin((166.56+132.87*T-0.009173*T2)*dr);
  const M=359.2242+29.10535608*k-0.0000333*T2-0.00000347*T3;
  const Mpr=306.0253+385.81691806*k+0.0107306*T2+0.00001236*T3;
  const F=21.2964+390.67050646*k-0.0016528*T2-0.00000239*T3;
  let C1=(0.1734-0.000393*T)*Math.sin(M*dr)+0.0021*Math.sin(2*dr*M);
  C1-=0.4068*Math.sin(Mpr*dr)+0.0161*Math.sin(dr*2*Mpr)-0.0004*Math.sin(dr*3*Mpr);
  C1+=0.0104*Math.sin(dr*2*F)-0.0051*Math.sin(dr*(M+Mpr))-0.0074*Math.sin(dr*(M-Mpr));
  C1+=0.0004*Math.sin(dr*(2*F+M))-0.0004*Math.sin(dr*(2*F-M))-0.0006*Math.sin(dr*(2*F+Mpr));
  C1+=0.0010*Math.sin(dr*(2*F-Mpr))+0.0005*Math.sin(dr*(2*Mpr+M));
  const deltat=T<-11?0.001+0.000839*T+0.0002261*T2-0.00000845*T3-0.000000081*T*T3:-0.000278+0.000265*T+0.000262*T2;
  return Jd1+C1-deltat;
}
function SunLongitude(jdn){
  const T=(jdn-2451545.0)/36525,T2=T*T,dr=PI/180;
  const M=357.52910+35999.05030*T-0.0001559*T2-0.00000048*T*T2;
  const L0=280.46645+36000.76983*T+0.0003032*T2;
  let DL=(1.914600-0.004817*T-0.000014*T2)*Math.sin(dr*M);
  DL+=(0.019993-0.000101*T)*Math.sin(dr*2*M)+0.000290*Math.sin(dr*3*M);
  let L=(L0+DL)*dr;L-=PI*2*Math.floor(L/(PI*2));
  return L;
}
function getNewMoonDay(k,tz){return Math.floor(NewMoon(k)+0.5+tz/24);}
function getSunLongitude(dn,tz){return Math.floor(SunLongitude(dn-0.5-tz/24)/PI*6);}
function getLunarMonth11(yy,tz){
  const off=jdFromDate(31,12,yy)-2415021;
  const k=Math.floor(off/29.530588853);
  let nm=getNewMoonDay(k,tz);
  if(getSunLongitude(nm,tz)>=9)nm=getNewMoonDay(k-1,tz);
  return nm;
}
function getLeapMonthOffset(a11,tz){
  const k=Math.floor((a11-2415021.076998695)/29.530588853+0.5);
  let last=0,i=1,arc=getSunLongitude(getNewMoonDay(k+i,tz),tz);
  do{last=arc;i++;arc=getSunLongitude(getNewMoonDay(k+i,tz),tz);}while(arc!==last&&i<14);
  return i-1;
}
function getLunarDate(dd,mm,yy,tz=7){
  const dayNumber=jdFromDate(dd,mm,yy);
  const k=Math.floor((dayNumber-2415021.076998695)/29.530588853);
  let monthStart=getNewMoonDay(k+1,tz);
  if(monthStart>dayNumber)monthStart=getNewMoonDay(k,tz);
  let a11=getLunarMonth11(yy,tz),b11=a11,lunarYear;
  if(a11>=monthStart){lunarYear=yy;a11=getLunarMonth11(yy-1,tz);}
  else{lunarYear=yy+1;b11=getLunarMonth11(yy+1,tz);}
  const lunarDay=dayNumber-monthStart+1;
  const diff=Math.floor((monthStart-a11)/29);
  let lunarLeap=0,lunarMonth=diff+11;
  if(b11-a11>365){
    const leapMonthDiff=getLeapMonthOffset(a11,tz);
    if(diff>=leapMonthDiff){lunarMonth=diff+10;if(diff===leapMonthDiff)lunarLeap=1;}
  }
  if(lunarMonth>12)lunarMonth-=12;
  if(lunarMonth>=11&&diff<4)lunarYear-=1;
  return{day:lunarDay,month:lunarMonth,year:lunarYear,leap:lunarLeap};
}

function getHolidayInfo(dateObj,lunar){
  const d=dateObj.getDate(),m=dateObj.getMonth()+1;
  if(m===1&&d===1)return{name:"Tết Dương lịch",isOff:true};
  if(m===4&&d===30)return{name:"Giải phóng MN 30/4",isOff:true};
  if(m===5&&d===1)return{name:"Quốc tế Lao động 1/5",isOff:true};
  if(m===9&&d===2)return{name:"Quốc khánh 2/9",isOff:true};
  if(!lunar.leap){
    if(lunar.month===1&&lunar.day>=1&&lunar.day<=3)return{name:`Tết Nguyên Đán (Mùng ${lunar.day})`,isOff:true};
    if(lunar.month===3&&lunar.day===10)return{name:"Giỗ Tổ Hùng Vương 10/3 ÂL",isOff:true};
    if(lunar.month===1&&lunar.day===15)return{name:"Rằm tháng Giêng",isOff:false};
    if(lunar.month===4&&lunar.day===15)return{name:"Lễ Phật Đản",isOff:false};
    if(lunar.month===5&&lunar.day===5)return{name:"Tết Đoan Ngọ 5/5 ÂL",isOff:false};
    if(lunar.month===7&&lunar.day===15)return{name:"Lễ Vu Lan 15/7 ÂL",isOff:false};
    if(lunar.month===8&&lunar.day===15)return{name:"Tết Trung Thu",isOff:false};
  }
  return null;
}

const WEEKDAYS=["CN","T2","T3","T4","T5","T6","T7"];
function computeDayCalendar(totalDays,startIso,skipOff){
  const map={};
  let cur=parseIsoDate(startIso||toLocalIso());
  for(let day=1;day<=totalDays;day++){
    let guard=0;
    while(guard<30){
      const lunar=getLunarDate(cur.getDate(),cur.getMonth()+1,cur.getFullYear(),7);
      const hol=getHolidayInfo(cur,lunar);
      const isSun=cur.getDay()===0;
      const isOff=isSun||Boolean(hol?.isOff);
      if(skipOff&&isOff){cur=new Date(cur.getTime()+86400000);guard++;continue;}
      const iso=toLocalIso(cur);
      const dd=String(cur.getDate()).padStart(2,"0"),mm=String(cur.getMonth()+1).padStart(2,"0");
      map[day]={
        iso,
        weekday:WEEKDAYS[cur.getDay()],
        solar:`${dd}/${mm}`,
        lunar:`${lunar.day}/${lunar.month}${lunar.leap?"N":""} ÂL`,
        holiday:hol?.name||"",
        isSunday:isSun,
        isOff
      };
      cur=new Date(cur.getTime()+86400000);
      break;
    }
  }
  return map;
}

// ── Tần suất viếng thăm ──────────────────────────────────────
function getVisitStatus(shop,todayIso=toLocalIso()){
  const freq=Number(shop?.freqDays)||0;
  if(freq<=0)return null;
  if(!shop.lastVisit)return{state:"due",label:"Chưa từng ghé",rank:2,cls:"due"};
  const elapsed=daysBetweenIso(shop.lastVisit,todayIso);
  const remain=freq-elapsed;
  if(remain<0)return{state:"overdue",label:`Quá hạn ${-remain} ngày`,rank:3,cls:"overdue"};
  if(remain===0)return{state:"due",label:"Đến hạn hôm nay",rank:2,cls:"due"};
  return{state:"ok",label:`Còn ${remain} ngày`,rank:1,cls:"ok"};
}

// ── Bóc tách tọa độ từ Link Google Maps / chuỗi ─────────────
function parseMapsLinkOrCoords(raw){
  const txt=String(raw||"").trim();
  if(!txt)return null;
  if(/maps\.app\.goo\.gl|goo\.gl\/maps/i.test(txt))return{shortLink:true};

  const patterns=[
    /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/,
    /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/,
    /(?:q|query|ll|destination|center)=(-?\d+(?:\.\d+)?)(?:,|%2C)\s*(-?\d+(?:\.\d+)?)/i,
    /^\s*(-?\d+(?:[.,]\d+)?)\s*[,;\s]\s*(-?\d+(?:[.,]\d+)?)\s*$/
  ];
  for(const re of patterns){
    const m=txt.match(re);
    if(m){
      const lat=parseFloat(m[1].replace(",","."));
      const lon=parseFloat(m[2].replace(",","."));
      if(!isNaN(lat)&&!isNaN(lon)&&Math.abs(lat)<=90&&Math.abs(lon)<=180){
        return{lat,lon};
      }
    }
  }
  return null;
}

// ── Thời tiết Open-Meteo (Cache 2 giờ) ──────────────────────
const WX_KEY="lt_wx_cache";
const WX_CODES={
  0:["☀️","Trời quang"],1:["🌤️","Ít mây"],2:["⛅","Có mây"],3:["☁️","Nhiều mây"],
  45:["🌫️","Sương mù"],48:["🌫️","Sương mù"],
  51:["🌦️","Mưa phùn"],53:["🌦️","Mưa phùn"],55:["🌦️","Mưa phùn"],
  61:["🌧️","Mưa nhẹ"],63:["🌧️","Mưa vừa"],65:["🌧️","Mưa to"],
  80:["🌦️","Mưa rào"],81:["🌧️","Mưa rào"],82:["⛈️","Mưa lớn"],
  95:["⛈️","Dông bão"],96:["⛈️","Dông sét"],99:["⛈️","Dông mạnh"]
};

async function fetchDayWeather(lat,lon,isoDate){
  if(lat==null||lon==null||!isoDate)return null;
  const gridKey=`${Number(lat).toFixed(2)},${Number(lon).toFixed(2)}`;
  let cache={};
  try{cache=JSON.parse(localStorage.getItem(WX_KEY)||"{}");}catch{cache={};}
  const hit=cache[gridKey];
  if(hit && (Date.now()-hit.ts)<7200000 && hit.days?.[isoDate])return hit.days[isoDate];
  if(!navigator.onLine)return hit?.days?.[isoDate]||null;
  try{
    const url=`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=weathercode,temperature_2m_max,temperature_2m_min,precipitation_probability_max&forecast_days=14&timezone=Asia%2FHo_Chi_Minh`;
    const res=await fetch(url,{cache:"no-store"});
    if(!res.ok)return hit?.days?.[isoDate]||null;
    const data=await res.json();
    const d=data?.daily;
    if(!d?.time?.length)return null;
    const days={};
    d.time.forEach((t,i)=>{
      const wc=d.weathercode?.[i]??1;
      const meta=WX_CODES[wc]||["🌤️","Có mây"];
      days[t]={icon:meta[0],text:meta[1],tMin:Math.round(d.temperature_2m_min?.[i]??0),tMax:Math.round(d.temperature_2m_max?.[i]??0),rain:d.precipitation_probability_max?.[i]??0};
    });
    cache[gridKey]={ts:Date.now(),days};
    localStorage.setItem(WX_KEY,JSON.stringify(cache));
    return days[isoDate]||null;
  }catch{
    return hit?.days?.[isoDate]||null;
  }
}

// ── OSRM Road Routing (Đường bộ thực tế, Cache 6 giờ) ───────
const OSRM_KEY="lt_osrm_cache";
async function fetchOSRMRoute(pts){
  if(!pts||pts.length<2||pts.length>25)return null;
  const coordStr=pts.map(p=>`${Number(p.lon).toFixed(5)},${Number(p.lat).toFixed(5)}`).join(";");
  let cache={};
  try{cache=JSON.parse(localStorage.getItem(OSRM_KEY)||"{}");}catch{cache={};}
  const hit=cache[coordStr];
  if(hit && (Date.now()-hit.ts)<21600000)return hit.data;
  if(!navigator.onLine)return hit?.data||null;

  const ctrl=new AbortController();
  const timer=setTimeout(()=>ctrl.abort(),6000);
  try{
    const url=`https://router.project-osrm.org/route/v1/driving/${coordStr}?overview=full&geometries=geojson&steps=false`;
    const res=await fetch(url,{signal:ctrl.signal});
    clearTimeout(timer);
    if(!res.ok)return hit?.data||null;
    const json=await res.json();
    const rt=json?.routes?.[0];
    if(!rt)return null;
    const data={
      totalKm:rt.distance/1000,
      totalMin:Math.round(rt.duration/60),
      legs:(rt.legs||[]).map(l=>({km:l.distance/1000,min:Math.round(l.duration/60)})),
      polyline:(rt.geometry?.coordinates||[]).map(([lon,lat])=>[lat,lon])
    };
    const keys=Object.keys(cache);
    if(keys.length>20)delete cache[keys[0]];
    cache[coordStr]={ts:Date.now(),data};
    localStorage.setItem(OSRM_KEY,JSON.stringify(cache));
    return data;
  }catch{
    clearTimeout(timer);
    return hit?.data||null;
  }
}
